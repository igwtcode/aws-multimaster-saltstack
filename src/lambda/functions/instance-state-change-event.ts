import { join } from 'path';
import { readdirSync, unlinkSync, renameSync } from 'fs';
import { AWSError } from 'aws-sdk';
import { Context } from 'aws-lambda';
import { InstanceIdList, SendCommandRequest } from 'aws-sdk/clients/ssm';
import {
  getDynamoClient,
  getEc2Client,
  getSsmClient,
  TAG_NAME,
  instanceInfoTableConfig,
  sleep,
  IInstanceData,
  INSTANCE_STATE,
  IInstanceStateChangeEvent,
  INSTANCE_TIER,
  filePath,
} from '/opt/nodejs/helpers';

const APP_ENV = process.env.APP_ENV!;
const PKI_DIR_PATH = process.env.PKI_DIR_PATH!;
const MINION_MASTER_CONF_PATH = filePath.saltMinion.master;

const acceptedKeysPath = join(PKI_DIR_PATH, 'minions');
const unAcceptedKeysPath = ['minions_pre', 'minions_denied', 'minions_rejected', 'minions_autosign'].map((dirName) =>
  join(PKI_DIR_PATH, dirName),
);
const allKeysDirectories = [acceptedKeysPath].concat(unAcceptedKeysPath);

const ec2Client = getEc2Client();
const dynamoClient = getDynamoClient();
const ssmClient = getSsmClient();

async function updateTable(instanceData: IInstanceData): Promise<void> {
  try {
    let updateExp =
      'set i_name = :a, i_state = :b, i_env = :c, i_tier = :e, minion_id = :j, i_private_ip = :f, i_public_ip = :g, updated_at = :h';
    let attr: any = {
      ':a': { S: instanceData.name },
      ':b': { S: instanceData.state },
      ':c': { S: instanceData.env },
      ':e': { S: instanceData.tier },
      ':j': { S: instanceData.minionId },
      ':f': { S: instanceData.privateIp },
      ':g': { S: instanceData.publicIp },
      ':h': { S: new Date().toLocaleString('de') },
    };
    // automatically delete item from table after about 1 minute if instance is terminated
    if (instanceData.state == INSTANCE_STATE.TERMINATED || instanceData.state == INSTANCE_STATE.SHUTTINGDOWN) {
      updateExp += `, ${instanceInfoTableConfig.ttlAttr} = :i`;
      const nowMs = new Date().getTime();
      attr[':i'] = { N: Math.floor(nowMs / 1000 + 60).toString() };
    }
    await dynamoClient
      .updateItem({
        TableName: instanceInfoTableConfig.tableName,
        Key: { [instanceInfoTableConfig.partionKey]: { S: instanceData.id } },
        UpdateExpression: updateExp,
        ExpressionAttributeValues: attr,
      })
      .promise();
  } catch (e) {
    console.log('UPDATE-DDB-TABLE::: ', e);
  }
}

async function getInstanceData(instanceId: string): Promise<IInstanceData | undefined> {
  try {
    const describeInstanceResult = await ec2Client
      .describeInstances({
        InstanceIds: [instanceId],
        Filters: [{ Name: `tag:${TAG_NAME.ENVIRONMENT}`, Values: [APP_ENV] }],
      })
      .promise();
    const instance = describeInstanceResult.Reservations?.shift()?.Instances?.shift();
    if (!instance) return;
    const id = instance.InstanceId ?? '';
    const name = instance.Tags?.find((tag) => tag.Key == TAG_NAME.NAME)?.Value ?? '';
    const tier = instance.Tags?.find((tag) => tag.Key == TAG_NAME.TIER)?.Value ?? '';
    const minionId =
      (tier == INSTANCE_TIER.MASTER || tier == INSTANCE_TIER.MINION) && name.length && id.length ? `${name}_${id}` : '';
    return {
      id,
      name,
      minionId,
      state: instance.State?.Name ?? '',
      env: instance.Tags?.find((tag) => tag.Key == TAG_NAME.ENVIRONMENT)?.Value ?? '',
      tier,
      privateIp: instance.PrivateIpAddress ?? '',
      publicIp: instance.PublicIpAddress ?? '',
    };
  } catch (e) {
    console.error('GET-INSTANCE-DATA::: ', e);
    return;
  }
}

async function getRunningSaltMastersIpList(): Promise<string[]> {
  try {
    const ipList: string[] = [];
    const res = await ec2Client
      .describeInstances({
        Filters: [
          { Name: `tag:${TAG_NAME.TIER}`, Values: [INSTANCE_TIER.MASTER] },
          { Name: `tag:${TAG_NAME.ENVIRONMENT}`, Values: [APP_ENV] },
          { Name: 'instance-state-name', Values: [INSTANCE_STATE.RUNNING] },
        ],
      })
      .promise();
    res.Reservations?.forEach((r) => {
      r.Instances?.forEach((instance) => {
        if (instance.PrivateIpAddress) ipList.push(instance.PrivateIpAddress);
      });
    });
    return ipList;
  } catch (e) {
    console.error('GET-RUNNING-SALT-MASTERS-IP-LIST::: ', e);
    return [];
  }
}

async function deleteMinionKey(minionId?: string): Promise<void> {
  if (minionId) {
    allKeysDirectories.forEach((dir) => {
      try {
        unlinkSync(join(dir, minionId));
      } catch (e) {
        console.error(e);
      }
    });
  } else {
    allKeysDirectories.forEach((dir) => {
      try {
        const keysToDelete = readdirSync(dir);
        keysToDelete.forEach((minionKeyFileName) => unlinkSync(join(dir, minionKeyFileName)));
      } catch (e) {
        console.error(e);
      }
    });
  }
}

async function acceptMinionKey(minionId: string): Promise<void> {
  let accepted = false;
  const destPath = join(acceptedKeysPath, minionId);
  for (let i = 0; i < 18 && !accepted; i++) {
    try {
      await sleep(6);
      console.debug('# TRY:::', i, 'ACCEPTED:::', accepted);
      unAcceptedKeysPath.forEach((dir) => {
        const containsMinionKey = readdirSync(dir).includes(minionId);
        console.debug('CHECKING-DIR:::', dir, 'CONTAINS-MINION-KEY:::', containsMinionKey);
        if (containsMinionKey) {
          if (accepted) {
            console.debug('DUPLICATED-DELETE-FROM:::', dir);
            unlinkSync(join(dir, minionId));
          } else {
            const currentPath = join(dir, minionId);
            console.debug('FOUND-UNACCEPTED-IN:::', currentPath, 'MOVE-MINION-KEY-TO:::', destPath);
            renameSync(currentPath, destPath);
            accepted = true;
          }
        }
      });
    } catch (e) {
      console.log('SALT-ACCEPT-MINION-KEY::: ', e);
    }
  }
}

async function updateMasterIpList(saltMasterIpList: string[], instanceIds?: InstanceIdList): Promise<void> {
  try {
    const comment = 'update masters for all minions and restart salt-minion';
    const restartCommand = 'systemctl restart salt-minion';
    const checkCommand = 'systemctl is-active --quiet salt-minion';
    const checkService = `sleep 6; ${checkCommand} || ${restartCommand};`;
    const commands: string[] = ['#!/bin/bash'];

    commands.push(`echo "START..."; echo "updating salt master ip list in ${MINION_MASTER_CONF_PATH}"`);
    commands.push(`echo "master:" > ${MINION_MASTER_CONF_PATH}`);
    saltMasterIpList.forEach((masterIp) => commands.push(`echo "  - ${masterIp}" >> ${MINION_MASTER_CONF_PATH}`));

    commands.push(`echo "deleting minion_master.pub key..."`);
    commands.push('rm -rf /etc/salt/pki/minion/minion_master.pub');
    commands.push(`echo "restarting salt-minion..."`);
    commands.push(restartCommand);
    commands.push(`for i in {1..3}; do ${checkService} done;`);
    commands.push(`echo "DONE."; exit 0;`);

    const param: SendCommandRequest = {
      DocumentName: 'AWS-RunShellScript',
      Parameters: { commands },
      Comment: comment,
      TimeoutSeconds: 30,
      CloudWatchOutputConfig: {
        CloudWatchOutputEnabled: true,
        CloudWatchLogGroupName: '/ssm/run-command/ec2-instance-state-change',
      },
    };
    if (instanceIds) {
      param.InstanceIds = instanceIds;
    } else {
      param.Targets = [
        { Key: `tag:${TAG_NAME.TIER}`, Values: [INSTANCE_TIER.MASTER, INSTANCE_TIER.MINION] },
        { Key: `tag:${TAG_NAME.ENVIRONMENT}`, Values: [APP_ENV] },
      ];
    }
    await ssmClient.sendCommand(param).promise();
  } catch (e) {
    console.log('SALT-UPDATE-MINIONS-MASTER-IP-LIST::: ', e);
    return;
  }
}

async function isInstanceUpAndRunning(instanceId: string): Promise<boolean> {
  try {
    const res = await ec2Client
      .describeInstanceStatus({
        InstanceIds: [instanceId],
        Filters: [{ Name: `tag:${TAG_NAME.ENVIRONMENT}`, Values: [APP_ENV] }],
      })
      .promise();
    const data = res.InstanceStatuses?.at(0);
    const stateName = data?.InstanceState?.Name;
    const instanceStatus = data?.InstanceStatus?.Status;
    const systemStatus = data?.SystemStatus?.Status;
    console.debug('STATE-NAME', stateName, 'INSTANCE-STATUS', instanceStatus, 'SYSTEM-STATUS', systemStatus);
    return stateName == INSTANCE_STATE.RUNNING && instanceStatus == 'ok' && systemStatus == 'ok';
  } catch (e) {
    const err = e as AWSError;
    console.error('IS-INSTANCE-UP-AND-RUNNING:::', err);
    return false;
  }
}

async function instanceUp(instanceData: IInstanceData): Promise<void> {
  try {
    const saltMasterIpList = await getRunningSaltMastersIpList();
    if (!saltMasterIpList.length) return;
    await updateMasterIpList(
      saltMasterIpList,
      instanceData.tier == INSTANCE_TIER.MASTER ? undefined : [instanceData.id],
    );
    await acceptMinionKey(instanceData.minionId);
  } catch (e) {
    console.error('SALT-INSTANCE-UP::: ', e);
  }
}

async function instanceDown(instanceData: IInstanceData): Promise<void> {
  try {
    const saltMasterIpList = await getRunningSaltMastersIpList();
    if (saltMasterIpList.length) {
      await deleteMinionKey(instanceData.minionId);
      if (instanceData.tier == INSTANCE_TIER.MASTER) await updateMasterIpList(saltMasterIpList);
    } else {
      await deleteMinionKey();
    }
  } catch (e) {
    console.error('SALT-INSTANCE-DOWN::: ', e);
  }
}

async function saltAction(instanceData: IInstanceData): Promise<void> {
  try {
    if (!(instanceData.tier == INSTANCE_TIER.MASTER || instanceData.tier == INSTANCE_TIER.MINION)) return;
    if (instanceData.state == INSTANCE_STATE.TERMINATED) {
      await instanceDown(instanceData);
    } else if (instanceData.state == INSTANCE_STATE.RUNNING) {
      // wait until instance is up and running
      for (let i = 0; i < 9; i++) {
        await sleep(18);
        if (await isInstanceUpAndRunning(instanceData.id)) break;
      }
      await sleep(3); // wait a little bit more until user data script is executed
      await instanceUp(instanceData);
    }
  } catch (e) {
    console.error('SALT-TAKE-ACTION::: ', e);
  }
}

export async function handler(event: IInstanceStateChangeEvent, _: Context): Promise<void> {
  const data = await getInstanceData(event.detail['instance-id']);
  if (!data) return;
  await updateTable(data);
  await saltAction(data);
}
