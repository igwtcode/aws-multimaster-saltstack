import { Construct } from 'constructs';
import * as path from 'path';
import * as _cdk from 'aws-cdk-lib';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as _events from 'aws-cdk-lib/aws-events';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as _dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as _lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as _eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

export interface IInstanceStateChangeEventProps {
  kmsKey: _kms.Key;
  instanceInfoTable: _dynamodb.Table;
  vpc: _ec2.Vpc;
  subnetSelections: constructs.IVpcSubnetSelections;
  securityGroups: constructs.ISecurityGroups;
  saltMaster: constructs.ISaltMaster;
  lambdaLayers: constructs.ILambdaLayers;
}

export class InstanceStateChangeEvent extends Construct {
  constructor(scope: Construct, props: IInstanceStateChangeEventProps) {
    super(scope, 'InstanceStateChangeEvent');

    /*********
     * EVENT RULE
     *********/
    const eventRule = new _events.Rule(scope, 'Ec2InstanceStateChangeEvent', {
      ruleName: `ec2-instance-state-change-${shared.appConfig.env}`,
      enabled: true,
      eventPattern: {
        account: [shared.appConfig.account],
        region: [shared.appConfig.region],
        source: ['aws.ec2'],
        detailType: ['EC2 Instance State-change Notification'],
      },
    });

    /*********
     * LAMBDA
     *********/
    const pkiDir = '/mnt/pki';
    const func = new _lambdaNodejs.NodejsFunction(scope, 'Ec2InstanceStateChangeLambdaFunction', {
      ...shared.lambdaProps,
      layers: [props.lambdaLayers.helpers],
      functionName: `ec2-instance-state-change-${shared.appConfig.env}`,
      entry: path.join(__dirname, '..', 'lambda', 'functions', 'instance-state-change-event.ts'),
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.private,
      securityGroups: [props.securityGroups.lambdaWithEfsAccess],
      timeout: _cdk.Duration.minutes(6),
      filesystem: {
        config: {
          arn: props.saltMaster.pkiFileSystemAccessPoint.accessPointArn,
          localMountPath: pkiDir,
        },
      },
    });
    func.addEnvironment('PKI_DIR_PATH', pkiDir);
    const alias = new _lambda.Alias(scope, 'Ec2InstanceStateChangeLambdaFunctionAlias', {
      aliasName: shared.appConfig.env,
      version: func.currentVersion,
    });
    alias.addAutoScaling({ minCapacity: 0, maxCapacity: 3 });
    alias.addToRolePolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: ['ec2:DescribeInstanceStatus', 'ec2:DescribeInstances', 'ssm:SendCommand'],
        resources: ['*'],
      }),
    );
    alias.addToRolePolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:DescribeMountTargets',
          'elasticfilesystem:DescribeAccessPoints',
        ],
        resources: [
          props.saltMaster.fileSystem.fileSystemArn,
          props.saltMaster.pkiFileSystemAccessPoint.accessPointArn,
        ],
      }),
    );
    props.kmsKey.grantEncryptDecrypt(alias);
    props.instanceInfoTable.grantWriteData(alias);

    eventRule.addTarget(new _eventsTargets.LambdaFunction(alias));
  }
}
