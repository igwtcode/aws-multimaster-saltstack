import { Construct } from 'constructs';
import * as path from 'path';
import * as yaml from 'yaml';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _sns from 'aws-cdk-lib/aws-sns';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as _logs from 'aws-cdk-lib/aws-logs';
import * as _ssm from 'aws-cdk-lib/aws-ssm';
import * as _lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as _snsSub from 'aws-cdk-lib/aws-sns-subscriptions';
import * as _s3 from 'aws-cdk-lib/aws-s3';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as _imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

interface ISaltMinionImageBuilderProps {
  kmsKey: _kms.Key;
  lambdaLayers: constructs.ILambdaLayers;
  subnetId: string;
  securityGroupIds: string[];
}

export class SaltMinionImageBuilder extends Construct {
  constructor(scope: Construct, props: ISaltMinionImageBuilderProps) {
    super(scope, 'SaltMinionImageBuilder');

    /*********
     * S3 BUCKET
     *********/
    const bucketName = shared.getBucketName(`${shared.ASG_NAME.MINION}-image-builder`);
    shared.setValueInScript('s3_sync', [
      {
        key: 'IMAGEBUILDER_SALT_MINION_BUCKET_NAME',
        value: bucketName,
      },
    ]);
    const bucket = new _s3.Bucket(this, `${shared.ASG_NAME.MINION}ImageBuilderBucket`, {
      bucketName,
      publicReadAccess: false,
      blockPublicAccess: _s3.BlockPublicAccess.BLOCK_ALL,
      encryption: _s3.BucketEncryption.KMS,
      encryptionKey: props.kmsKey,
      bucketKeyEnabled: true,
      versioned: true,
      enforceSSL: true,
      autoDeleteObjects: true,
      objectOwnership: _s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
    });
    bucket.addLifecycleRule({
      enabled: true,
      abortIncompleteMultipartUploadAfter: _cdk.Duration.days(3),
      noncurrentVersionExpiration: _cdk.Duration.days(90),
      noncurrentVersionsToRetain: 9,
      noncurrentVersionTransitions: [
        { transitionAfter: _cdk.Duration.days(30), storageClass: _s3.StorageClass.INFREQUENT_ACCESS },
        { transitionAfter: _cdk.Duration.days(60), storageClass: _s3.StorageClass.GLACIER_INSTANT_RETRIEVAL },
      ],
      transitions: [
        { transitionAfter: _cdk.Duration.days(45), storageClass: _s3.StorageClass.INFREQUENT_ACCESS },
        { transitionAfter: _cdk.Duration.days(90), storageClass: _s3.StorageClass.GLACIER_INSTANT_RETRIEVAL },
      ],
    });

    /*********
     * EC2 IMAGE BUILDER INSTANCE ROLE AND PROFILE
     *********/
    const roleName = `${shared.ASG_NAME.MINION}-image-builder-role`;
    const role = new _iam.Role(this, roleName, {
      roleName,
      assumedBy: new _iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    bucket.grantRead(role);
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'));
    const profileName = `${roleName}-profile`;
    const profile = new _iam.CfnInstanceProfile(this, profileName, {
      roles: [role.roleName],
      instanceProfileName: profileName,
    });

    /*********
     * SNS TOPIC AND LAMBDA
     *********/
    const snsTopic = new _sns.Topic(this, `${shared.ASG_NAME.MINION}ImageBuilderSnsTopic`, {
      topicName: `${shared.ASG_NAME.MINION}-image-builder`,
    });

    const lambdaFunc = new _lambdaNodejs.NodejsFunction(this, `${shared.ASG_NAME.MINION}ImageBuilderLambdaFunction`, {
      ...shared.lambdaProps,
      layers: [props.lambdaLayers.helpers],
      functionName: `${shared.ASG_NAME.MINION}-image-builder`,
      entry: path.join(__dirname, '..', 'lambda', 'functions', 'salt-minion-image-builder.ts'),
      description: `on sns notification, create launch template version, refresh instances in asg and delete older images`,
    });
    const lambdaAlias = new _lambda.Alias(this, `${shared.ASG_NAME.MINION}ImageBuilderLambdaFunctionAlias`, {
      aliasName: shared.appConfig.env,
      version: lambdaFunc.currentVersion,
    });
    lambdaAlias.addAutoScaling({ minCapacity: 0, maxCapacity: 2 });
    lambdaAlias.addToRolePolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: ['ssm:PutParameter'],
        resources: [shared.ARN.ssmParameter(shared.ssmParamNames.ami.saltMinion)],
      }),
    );
    lambdaAlias.addToRolePolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: [
          'iam:PassRole',
          'ec2:RunInstances',
          'ec2:CreateTags',
          'ec2:CreateLaunchTemplateVersion',
          'ec2:ModifyLaunchTemplate',
          'ec2:DescribeImages',
          'ec2:DeregisterImage',
          'ec2:DescribeSnapshots',
          'ec2:DeleteSnapshot',
          'autoscaling:UpdateAutoScalingGroup',
          'autoscaling:StartInstanceRefresh',
        ],
        resources: ['*'],
      }),
    );
    snsTopic.addSubscription(new _snsSub.LambdaSubscription(lambdaAlias));

    /*********
     * IMAGE BUILDER PIPELINE
     *********/
    const steps = [
      {
        name: 'CreateDirectories',
        action: 'ExecuteBash',
        inputs: {
          commands: [shared.dirPath.backup, shared.dirPath.saltData, shared.dirPath.scripts].map(
            (dir) => `mkdir -p ${dir}`,
          ),
        },
      },
      {
        name: 'DownloadScripts',
        action: 'S3Download',
        inputs: [
          {
            source: `s3://${bucket.bucketName}/bash_profile.sh`,
            destination: shared.filePath.scripts.userBashProfile,
            overwrite: true,
          },
          {
            source: `s3://${bucket.bucketName}/install.sh`,
            destination: shared.filePath.scripts.install,
            overwrite: true,
          },
          {
            source: `s3://${bucket.bucketName}/service-cron.sh`,
            destination: shared.filePath.scripts.serviceCron,
            overwrite: true,
          },
        ],
      },
      {
        name: 'ExecuteScripts',
        action: 'ExecuteBash',
        inputs: {
          commands: [
            `echo "alias startCWA='sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:${shared.filePath.cwAgentConf}'" >> ${shared.filePath.scripts.userBashProfile}`,
            `cp ${shared.filePath.scripts.userBashProfile} ${shared.filePath.scripts.rootBashProfile}`,
            `source ~/.bash_profile`,
            `chmod +x ${shared.filePath.scripts.serviceCron}`,
            `chmod +x ${shared.filePath.scripts.install}`,
            `bash ${shared.filePath.scripts.install}`,
            `rm -rf ${shared.filePath.scripts.install}`,
          ],
        },
      },
      {
        name: 'DownloadCloudWatchAgentConfigFile',
        action: 'S3Download',
        inputs: [
          {
            source: `s3://${bucket.bucketName}/cw-agent-conf.json`,
            destination: shared.filePath.cwAgentConf,
            overwrite: true,
          },
        ],
      },
    ];

    const component = new _imagebuilder.CfnComponent(this, `${shared.ASG_NAME.MINION}ImageBuilderComponent`, {
      name: shared.ASG_NAME.MINION,
      platform: 'Linux',
      version: '1.0.0',
      data: yaml.stringify(
        {
          name: `${shared.ASG_NAME.MINION}Component`,
          schemaVersion: '1.0',
          phases: [{ name: 'build', steps }],
        },
        { indent: 2 },
      ),
    });

    const imageRecipe = new _imagebuilder.CfnImageRecipe(this, `${shared.ASG_NAME.MINION}ImageBuilderRecipe`, {
      name: shared.ASG_NAME.MINION,
      version: '1.0.0',
      parentImage: _ssm.StringParameter.valueFromLookup(this, shared.ssmParamNames.ami.amazonLinux2),
      components: [{ componentArn: component.attrArn }],
    });

    const infrastructureConf = new _imagebuilder.CfnInfrastructureConfiguration(
      this,
      `${shared.ASG_NAME.MINION}ImageBuilderInfraConf`,
      {
        name: shared.ASG_NAME.MINION,
        instanceTypes: [shared.INSTANCE_TYPE.T2MICRO],
        instanceProfileName: profile.instanceProfileName!,
        snsTopicArn: snsTopic.topicArn,
        terminateInstanceOnFailure: true,
        subnetId: props.subnetId,
        securityGroupIds: props.securityGroupIds,
      },
    );
    infrastructureConf.addDependency(profile);

    const distributionConf = new _imagebuilder.CfnDistributionConfiguration(
      this,
      `${shared.ASG_NAME.MINION}ImageBuilderDistributionConfig`,
      {
        name: shared.ASG_NAME.MINION,
        distributions: [
          {
            region: shared.appConfig.region,
            amiDistributionConfiguration: {
              name: `${shared.ASG_NAME.MINION}-{{ imagebuilder:buildDate }}`,
              amiTags: { Name: shared.ASG_NAME.MINION },
              targetAccountIds: [shared.appConfig.account],
              description: `Based on Amazon Linux 2`,
            },
          },
        ],
      },
    );

    const pipeline = new _imagebuilder.CfnImagePipeline(this, `${shared.ASG_NAME.MINION}ImageBuilderPipelineConfig`, {
      name: shared.ASG_NAME.MINION,
      imageRecipeArn: imageRecipe.attrArn,
      infrastructureConfigurationArn: infrastructureConf.attrArn,
      distributionConfigurationArn: distributionConf.attrArn,
      schedule: {
        pipelineExecutionStartCondition: 'EXPRESSION_MATCH_ONLY',
        scheduleExpression: 'cron(30 5 * * ? *)',
        // EVERY DAY 5:30 UTC -> 7:30 BERLIN
      },
    });
    shared.setValueInScript('imagebuilder_pipeline_exec', [
      {
        key: 'IMAGEBUILDER_SALT_MINION_ARN',
        value: shared.ARN.imageBuilderPipeline(pipeline.name),
      },
    ]);
  }
}
