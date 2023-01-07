import { Construct } from 'constructs';
import * as path from 'path';
import * as yaml from 'yaml';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _sns from 'aws-cdk-lib/aws-sns';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as _logs from 'aws-cdk-lib/aws-logs';
import * as _lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as _snsSub from 'aws-cdk-lib/aws-sns-subscriptions';
import * as _ssm from 'aws-cdk-lib/aws-ssm';
import * as _s3 from 'aws-cdk-lib/aws-s3';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as _imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

interface ISaltMasterImageBuilderProps {
  kmsKey: _kms.Key;
  subnetId: string;
  securityGroupIds: string[];
  lambdaLayers: constructs.ILambdaLayers;
}

export interface ISaltApiCredentialsSsmParameters {
  username: _ssm.StringParameter;
  password: _ssm.StringParameter;
}

export class SaltMasterImageBuilder extends Construct {
  public saltApiSsmParameters: ISaltApiCredentialsSsmParameters;

  constructor(scope: Construct, props: ISaltMasterImageBuilderProps) {
    super(scope, 'SaltMasterImageBuilder');

    /*********
     * S3 BUCKET
     *********/
    const bucketName = shared.getBucketName(`${shared.ASG_NAME.MASTER}-image-builder`);
    shared.setValueInScript('s3_sync', [
      {
        key: 'IMAGEBUILDER_SALT_MASTER_BUCKET_NAME',
        value: bucketName,
      },
    ]);
    const bucket = new _s3.Bucket(this, `${shared.ASG_NAME.MASTER}ImageBuilderBucket`, {
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
     * SALT API CREDENTIALS SSM PARAMETERS
     *********/
    const saltApiUsernameSsmParameter = new _ssm.StringParameter(this, 'SaltApiUsernameSsmParameter', {
      parameterName: shared.ssmParamNames.credentials.saltApiUsername,
      stringValue: shared.appConfig.saltApiUser,
      description: `Salt Api Username - ${shared.appConfig.env}`,
      dataType: _ssm.ParameterDataType.TEXT,
      tier: _ssm.ParameterTier.STANDARD,
    });
    const saltApiPasswordSsmParameter = new _ssm.StringParameter(this, 'SaltApiPasswordSsmParameter', {
      parameterName: shared.ssmParamNames.credentials.saltApiPassword,
      stringValue: shared.appConfig.saltApiPassword,
      description: `Salt Api Password - ${shared.appConfig.env}`,
      dataType: _ssm.ParameterDataType.TEXT,
      tier: _ssm.ParameterTier.STANDARD,
    });

    /*********
     * EC2 IMAGE BUILDER INSTANCE ROLE AND PROFILE
     *********/
    const roleName = `${shared.ASG_NAME.MASTER}-image-builder-role`;
    const role = new _iam.Role(this, roleName, {
      roleName,
      assumedBy: new _iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    bucket.grantRead(role);
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'));
    saltApiUsernameSsmParameter.grantRead(role);
    saltApiPasswordSsmParameter.grantRead(role);
    const profileName = `${roleName}-profile`;
    const profile = new _iam.CfnInstanceProfile(this, profileName, {
      roles: [role.roleName],
      instanceProfileName: profileName,
    });

    /*********
     * SNS TOPIC AND LAMBDA
     *********/
    const snsTopic = new _sns.Topic(this, `${shared.ASG_NAME.MASTER}ImageBuilderSnsTopic`, {
      topicName: `${shared.ASG_NAME.MASTER}-image-builder`,
    });

    const lambdaFunc = new _lambdaNodejs.NodejsFunction(this, `${shared.ASG_NAME.MASTER}ImageBuilderLambdaFunction`, {
      ...shared.lambdaProps,
      layers: [props.lambdaLayers.helpers],
      functionName: `${shared.ASG_NAME.MASTER}-image-builder`,
      entry: path.join(__dirname, '..', 'lambda', 'functions', 'salt-master-image-builder.ts'),
      description: `on sns notification, create launch template version, refresh instances in asg and delete older images`,
    });
    const lambdaAlias = new _lambda.Alias(this, `${shared.ASG_NAME.MASTER}ImageBuilderLambdaFunctionAlias`, {
      aliasName: shared.appConfig.env,
      version: lambdaFunc.currentVersion,
    });
    lambdaAlias.addAutoScaling({ minCapacity: 0, maxCapacity: 2 });
    lambdaAlias.addToRolePolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: ['ssm:PutParameter'],
        resources: [shared.ARN.ssmParameter(shared.ssmParamNames.ami.saltMaster)],
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
            `SALT_API_USERNAME=$(aws --region=${shared.appConfig.region} ssm get-parameter --name ${shared.ssmParamNames.credentials.saltApiUsername} --with-decryption --output text --query Parameter.Value)`,
            `SALT_API_PASSWORD=$(aws --region=${shared.appConfig.region} ssm get-parameter --name ${shared.ssmParamNames.credentials.saltApiPassword} --with-decryption --output text --query Parameter.Value)`,
            'useradd -m -d /var/lib/${SALT_API_USERNAME} -r -s /usr/sbin/nologin ${SALT_API_USERNAME}',
            'echo ${SALT_API_PASSWORD} | passwd ${SALT_API_USERNAME} --stdin',
            'unset SALT_API_USERNAME',
            'unset SALT_API_PASSWORD',
            `bash ${shared.filePath.scripts.install}`,
            `rm -rf ${shared.filePath.scripts.install}`,
          ],
        },
      },
      {
        name: 'CreateSaltMasterConfigFile',
        action: 'CreateFile',
        inputs: [
          {
            path: shared.filePath.saltMaster.conf,
            overwrite: true,
            content: yaml.stringify(
              {
                worker_threads: 3,
                external_auth: { pam: { XXX: ['.*', '@wheel', '@runner', '@local'] } },
                rest_cherrypy: {
                  debug: true,
                  disable_ssl: true,
                  port: 80,
                  host: '0.0.0.0',
                  log_access_file: shared.filePath.saltMaster.apiAccessLog,
                  log_error_file: shared.filePath.saltMaster.apiErrorLog,
                },
              },
              { indent: 2, trueStr: 'True' },
            ),
          },
        ],
      },
      {
        name: 'SetSaltApiUserInSaltMasterConf',
        action: 'ExecuteBash',
        inputs: {
          commands: [
            `SALT_API_USERNAME=$(aws --region=${shared.appConfig.region} ssm get-parameter --name ${shared.ssmParamNames.credentials.saltApiUsername} --with-decryption --output text --query Parameter.Value)`,
            `sed -i "s/XXX/$SALT_API_USERNAME/" ${shared.filePath.saltMaster.conf}`,
            'unset SALT_API_USERNAME',
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

    const component = new _imagebuilder.CfnComponent(this, `${shared.ASG_NAME.MASTER}ImageBuilderComponent`, {
      name: shared.ASG_NAME.MASTER,
      platform: 'Linux',
      version: '1.0.0',
      data: yaml.stringify(
        {
          name: `${shared.ASG_NAME.MASTER}Component`,
          schemaVersion: '1.0',
          phases: [{ name: 'build', steps }],
        },
        { indent: 2 },
      ),
    });

    const imageRecipe = new _imagebuilder.CfnImageRecipe(this, `${shared.ASG_NAME.MASTER}ImageBuilderRecipe`, {
      name: shared.ASG_NAME.MASTER,
      version: '1.0.0',
      parentImage: _ssm.StringParameter.valueFromLookup(this, shared.ssmParamNames.ami.amazonLinux2),
      components: [{ componentArn: component.attrArn }],
    });

    const infrastructureConf = new _imagebuilder.CfnInfrastructureConfiguration(
      this,
      `${shared.ASG_NAME.MASTER}ImageBuilderInfraConf`,
      {
        name: shared.ASG_NAME.MASTER,
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
      `${shared.ASG_NAME.MASTER}ImageBuilderDistributionConfig`,
      {
        name: shared.ASG_NAME.MASTER,
        distributions: [
          {
            region: shared.appConfig.region,
            amiDistributionConfiguration: {
              name: `${shared.ASG_NAME.MASTER}-{{ imagebuilder:buildDate }}`,
              amiTags: { Name: shared.ASG_NAME.MASTER },
              targetAccountIds: [shared.appConfig.account],
              description: `Based on Amazon Linux 2`,
            },
          },
        ],
      },
    );

    const pipeline = new _imagebuilder.CfnImagePipeline(this, `${shared.ASG_NAME.MASTER}ImageBuilderPipelineConfig`, {
      name: shared.ASG_NAME.MASTER,
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
        key: 'IMAGEBUILDER_SALT_MASTER_ARN',
        value: shared.ARN.imageBuilderPipeline(pipeline.name),
      },
    ]);

    /*********
     * OUTPUTS
     *********/
    this.saltApiSsmParameters = {
      username: saltApiUsernameSsmParameter,
      password: saltApiPasswordSsmParameter,
    };
  }
}
