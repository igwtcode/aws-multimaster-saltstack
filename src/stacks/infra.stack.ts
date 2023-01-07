import { Construct } from 'constructs';
import * as _cdk from 'aws-cdk-lib';
import * as shared from '@src/shared';
import * as constructs from '@src/constructs';

export class Infra extends _cdk.Stack {
  constructor(scope: Construct) {
    super(scope, `Infra-${shared.appConfig.env}`, {
      synthesizer: new _cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
      ...shared.stackProps,
    });

    new constructs.BudgetAlarm(this);

    const { kmsKey } = new constructs.KmsKey(this);

    const { instanceInfoTable } = new constructs.InstanceInfoTable(this, { kmsKey });

    const { vpc, subnetSelections, securityGroups } = new constructs.Network(this);

    const { lambdaLayers } = new constructs.LambdaLayers(this);

    const { saltApiSsmParameters } = new constructs.SaltMasterImageBuilder(this, {
      kmsKey,
      lambdaLayers,
      subnetId: vpc.privateSubnets.at(0)!.subnetId,
      securityGroupIds: [securityGroups.outboundHttps.securityGroupId],
    });

    new constructs.SaltMinionImageBuilder(this, {
      kmsKey,
      lambdaLayers,
      subnetId: vpc.privateSubnets.at(0)!.subnetId,
      securityGroupIds: [securityGroups.outboundHttps.securityGroupId],
    });

    const { hostedZones } = new constructs.HostedZones(this, { vpc });

    const { saltMaster } = new constructs.SaltMaster(this, {
      kmsKey,
      hostedZones,
      vpc,
      subnetSelections,
      securityGroups,
    });

    new constructs.InstanceStateChangeEvent(this, {
      kmsKey,
      saltMaster,
      vpc,
      subnetSelections,
      securityGroups,
      instanceInfoTable,
      lambdaLayers,
    });

    new constructs.SaltMinion(this, {
      kmsKey,
      vpc,
      subnetSelections,
      securityGroups,
    });

    new constructs.AppApi(this, {
      kmsKey,
      vpc,
      subnetSelections,
      securityGroups,
      hostedZones,
      instanceInfoTable,
      saltApiSsmParameters,
      lambdaLayers,
    });
  }
}
