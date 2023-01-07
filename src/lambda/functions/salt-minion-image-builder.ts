import { Context, SNSEvent } from 'aws-lambda';
import { getAsgClient, getEc2Client, getSsmClient, ASG_NAME, TAG_NAME, ssmParamNames } from '/opt/nodejs/helpers';

const asgName = ASG_NAME.MINION;
const ssmParamName = ssmParamNames.ami.saltMinion;

const ec2Client = getEc2Client();
const asgClient = getAsgClient();
const ssmClient = getSsmClient();

function getAmiId(event: SNSEvent): string | undefined {
  let amiId: string;
  try {
    const message = event.Records.shift()?.Sns.Message;
    if (!message) return;
    const msg = JSON.parse(message);
    if (!msg) return;
    amiId = msg.outputResources?.amis?.shift()?.image;
    console.log('AMI-ID::: ', amiId);
    return amiId;
  } catch (e) {
    console.error(e);
    return;
  }
}

async function putAmiIdInSsmParam(amiId: string): Promise<void> {
  try {
    await ssmClient
      .putParameter({
        Name: ssmParamName,
        Value: amiId,
        Overwrite: true,
        Type: 'String',
        DataType: 'aws:ec2:image',
        Description: `${asgName} golden ami created by ec2 image builder pipeline`,
      })
      .promise();
  } catch (e) {
    console.error(e);
  }
}

async function createNewLaunchTemplate(amiId: string): Promise<string | undefined> {
  try {
    const ltv = await ec2Client
      .createLaunchTemplateVersion({
        LaunchTemplateName: asgName,
        SourceVersion: '$Latest',
        VersionDescription: 'new ami created by ec2 image builder pipeline',
        LaunchTemplateData: { ImageId: amiId },
      })
      .promise();
    return (ltv.LaunchTemplateVersion?.VersionNumber?.toString() as string) ?? '1';
  } catch (e) {
    console.error(e);
    return;
  }
}

async function updateAsg(newLaunchTemplateVersion: string): Promise<boolean> {
  try {
    await ec2Client
      .modifyLaunchTemplate({
        LaunchTemplateName: asgName,
        DefaultVersion: newLaunchTemplateVersion,
      })
      .promise();
    await asgClient
      .updateAutoScalingGroup({
        AutoScalingGroupName: asgName,
        LaunchTemplate: { LaunchTemplateName: asgName, Version: '$Default' },
      })
      .promise();
    await asgClient.startInstanceRefresh({ AutoScalingGroupName: asgName }).promise();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function deleteOldAmi(): Promise<void> {
  try {
    const imageList = (
      await ec2Client
        .describeImages({
          Owners: ['self'],
          Filters: [{ Name: `tag:${TAG_NAME.NAME}`, Values: [asgName] }],
        })
        .promise()
    ).Images;
    if (!imageList) return;

    // sort: oldest image(first item) -> newest image(last item)
    imageList.sort((a, b) => (!a.CreationDate || !b.CreationDate ? 0 : a.CreationDate < b.CreationDate ? -1 : 0));

    // keep the latest (remove from the list)
    imageList.pop();

    // delete all ami in the list
    for (const image of imageList) {
      const imageId = image.ImageId;
      if (!imageId) continue;
      const snapshotIds = image.BlockDeviceMappings?.map((device) => device.Ebs?.SnapshotId);
      console.log('IMAGE-TO-DELETE::: ', image.Name, image.ImageId);
      await ec2Client.deregisterImage({ ImageId: imageId }).promise();
      if (!snapshotIds) continue;
      for (const snapshotId of snapshotIds) {
        if (!snapshotId) continue;
        await ec2Client.deleteSnapshot({ SnapshotId: snapshotId }).promise();
      }
    }
  } catch (e) {
    console.error(e);
  }
}

export const handler = async (event: SNSEvent, _: Context): Promise<void> => {
  const amiId = getAmiId(event);
  if (!amiId) return;
  await putAmiIdInSsmParam(amiId);
  const newLaunchTemplateVersion = await createNewLaunchTemplate(amiId);
  if (!newLaunchTemplateVersion) return;
  const updateRes = await updateAsg(newLaunchTemplateVersion);
  if (updateRes) await deleteOldAmi();
};
