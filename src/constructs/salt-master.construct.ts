import { Construct } from 'constructs';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _logs from 'aws-cdk-lib/aws-logs';
import * as _route53 from 'aws-cdk-lib/aws-route53';
import * as _route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as _acm from 'aws-cdk-lib/aws-certificatemanager';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as _autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as _s3 from 'aws-cdk-lib/aws-s3';
import * as _albv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as _efs from 'aws-cdk-lib/aws-efs';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

interface ISaltMasterProps {
  kmsKey: _kms.Key;
  vpc: _ec2.Vpc;
  subnetSelections: constructs.IVpcSubnetSelections;
  securityGroups: constructs.ISecurityGroups;
  hostedZones: constructs.IHostedZones;
}

export interface ISaltMaster {
  fileSystem: _efs.FileSystem;
  pkiFileSystemAccessPoint: _efs.AccessPoint;
  dataFileSystemAccessPoint: _efs.AccessPoint;
  backupFileSystemAccessPoint: _efs.AccessPoint;
}

export class SaltMaster extends Construct {
  public saltMaster: ISaltMaster;

  constructor(scope: Construct, props: ISaltMasterProps) {
    super(scope, 'SaltMaster');

    /*********
     * S3 BUCKET AND BUCKET REPLICATION
     *********/
    const sourceBucketName = shared.getBucketName(shared.ASG_NAME.MASTER);
    shared.setValueInScript('s3_sync', [
      {
        key: 'SALT_MASTER_BUCKET_NAME',
        value: sourceBucketName,
      },
    ]);
    const sourceBucket = new _s3.Bucket(this, `${shared.ASG_NAME.MASTER}Bucket`, {
      bucketName: sourceBucketName,
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
    sourceBucket.addLifecycleRule({
      enabled: true,
      abortIncompleteMultipartUploadAfter: _cdk.Duration.days(3),
      noncurrentVersionExpiration: _cdk.Duration.days(180),
      noncurrentVersionsToRetain: 18,
      noncurrentVersionTransitions: [
        { transitionAfter: _cdk.Duration.days(30), storageClass: _s3.StorageClass.INFREQUENT_ACCESS },
        { transitionAfter: _cdk.Duration.days(90), storageClass: _s3.StorageClass.GLACIER_INSTANT_RETRIEVAL },
      ],
      transitions: [{ transitionAfter: _cdk.Duration.days(45), storageClass: _s3.StorageClass.INFREQUENT_ACCESS }],
    });

    // Replica Bucket
    const destinationBucket = new _s3.Bucket(this, `${shared.ASG_NAME.MASTER}ReplicaBucket`, {
      bucketName: shared.getBucketName(`${shared.ASG_NAME.MASTER}-replica`),
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
    destinationBucket.addLifecycleRule({
      enabled: true,
      abortIncompleteMultipartUploadAfter: _cdk.Duration.days(3),
      noncurrentVersionExpiration: _cdk.Duration.days(180),
      noncurrentVersionsToRetain: 18,
      noncurrentVersionTransitions: [
        { transitionAfter: _cdk.Duration.days(30), storageClass: _s3.StorageClass.INFREQUENT_ACCESS },
        { transitionAfter: _cdk.Duration.days(90), storageClass: _s3.StorageClass.GLACIER_INSTANT_RETRIEVAL },
      ],
      transitions: [{ transitionAfter: _cdk.Duration.days(45), storageClass: _s3.StorageClass.INFREQUENT_ACCESS }],
    });

    // Replication Rule
    const cfnSourceBucket = sourceBucket.node.defaultChild as _s3.CfnBucket;

    const bucketReplicationRoleName = `${shared.ASG_NAME.MASTER}-bucket-replication-role`;
    const bucketReplicationRole = new _iam.Role(this, bucketReplicationRoleName, {
      roleName: bucketReplicationRoleName,
      assumedBy: new _iam.ServicePrincipal('s3.amazonaws.com'),
    });
    props.kmsKey.grantDecrypt(bucketReplicationRole);

    bucketReplicationRole.addToPolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        resources: [destinationBucket.arnForObjects('*')],
        actions: [
          's3:ReplicateObject',
          's3:ReplicateDelete',
          's3:ReplicateTags',
          's3:GetObjectVersionTagging',
          's3:ObjectOwnerOverrideToBucketOwner',
        ],
      }),
    );
    bucketReplicationRole.addToPolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        resources: [sourceBucket.bucketArn],
        actions: ['s3:GetReplicationConfiguration', 's3:ListBucket'],
      }),
    );
    bucketReplicationRole.addToPolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        resources: [sourceBucket.arnForObjects('*')],
        actions: [
          's3:GetObjectVersion',
          's3:GetObjectVersionAcl',
          's3:GetObjectVersionTagging',
          's3:GetObjectVersionForReplication',
          's3:GetObjectLegalHold',
          's3:GetObjectRetention',
        ],
      }),
    );

    cfnSourceBucket.replicationConfiguration = {
      role: bucketReplicationRole.roleArn,
      rules: [
        {
          destination: {
            storageClass: shared.ReplicationDestinationStorageClass.STANDARD,
            bucket: destinationBucket.bucketArn,
            account: shared.appConfig.account,
          },
          status: shared.ReplicationRuleStatus.ENABLED,
        },
      ],
    };

    /*********
     * EFS FILESYSTEM
     *********/
    const fileSystem = new _efs.FileSystem(this, `${shared.ASG_NAME.MASTER}FileSystem`, {
      fileSystemName: shared.ASG_NAME.MASTER,
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.isolated,
      securityGroup: props.securityGroups.saltMasterEfs,
      encrypted: true,
      kmsKey: props.kmsKey,
      enableAutomaticBackups: true,
      performanceMode: _efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: _efs.ThroughputMode.BURSTING,
      outOfInfrequentAccessPolicy: _efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS,
      lifecyclePolicy: _efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
    });

    const pkiFileSystemAccessPoint = fileSystem.addAccessPoint(`${shared.ASG_NAME.MASTER}PkiFileSystemAccessPoint`, {
      path: '/pki',
      posixUser: {
        gid: '0',
        uid: '0',
      },
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0777',
      },
    });
    const dataFileSystemAccessPoint = fileSystem.addAccessPoint(`${shared.ASG_NAME.MASTER}DataFileSystemAccessPoint`, {
      path: '/data',
      posixUser: {
        gid: '0',
        uid: '0',
      },
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0777',
      },
    });
    const backupFileSystemAccessPoint = fileSystem.addAccessPoint(
      `${shared.ASG_NAME.MASTER}BackupFileSystemAccessPoint`,
      {
        path: '/backup',
        posixUser: {
          gid: '0',
          uid: '0',
        },
        createAcl: {
          ownerGid: '0',
          ownerUid: '0',
          permissions: '0777',
        },
      },
    );

    /*********
     * APPLICATION LOAD BALANCER (SALT API ALB)
     *********/
    const alb = new _albv2.ApplicationLoadBalancer(this, 'SaltApiAlb', {
      loadBalancerName: `salt-api-alb-${shared.appConfig.env}`,
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.isolated,
      securityGroup: props.securityGroups.saltApiAlb,
      http2Enabled: true,
      internetFacing: false,
      ipAddressType: _albv2.IpAddressType.IPV4,
      deletionProtection: false,
      idleTimeout: _cdk.Duration.seconds(90),
    });
    alb.addRedirect({
      open: false,
      sourceProtocol: _albv2.ApplicationProtocol.HTTP,
      targetProtocol: _albv2.ApplicationProtocol.HTTPS,
    });

    const albCertificate = new _acm.DnsValidatedCertificate(this, 'SaltApiAlbCertificate', {
      certificateName: `salt-api-alb-${shared.appConfig.env}`,
      hostedZone: props.hostedZones.public,
      domainName: shared.domainNames.saltApi,
      cleanupRoute53Records: true,
      region: shared.appConfig.region,
      validation: _acm.CertificateValidation.fromDns(props.hostedZones.public),
    });

    const albListener = alb.addListener(`SaltApiAlbHttpsListener`, {
      open: false,
      protocol: _albv2.ApplicationProtocol.HTTPS,
      certificates: [albCertificate],
    });
    albListener.addAction('NotFoundDefaultAction', {
      action: _albv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/html',
        messageBody: '<h1>404 Not Found!</h1>',
      }),
    });
    albListener.addAction('WhoAmIAction', {
      priority: 60,
      conditions: [_albv2.ListenerCondition.pathPatterns(['/whoami'])],
      action: _albv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: '<h1>salt-api</h1>',
      }),
    });

    const record = new _route53.ARecord(this, `SaltApiAlbRoute53Record${shared.domainNames.saltApi.replace('.', '')}`, {
      recordName: shared.domainNames.saltApi,
      zone: props.hostedZones.private,
      ttl: _cdk.Duration.days(3),
      target: _route53.RecordTarget.fromAlias(new _route53Targets.LoadBalancerTarget(alb)),
    });

    /*********
     * LAUNCH TEMPLATE
     *********/
    const roleName = `${shared.ASG_NAME.MASTER}-instance-role`;
    const role = new _iam.Role(this, roleName, {
      roleName,
      assumedBy: new _iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    sourceBucket.grantReadWrite(role);
    props.kmsKey.grantEncryptDecrypt(role);
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    role.addToPolicy(shared.cwAgentPolicy);
    role.addToPolicy(
      new _iam.PolicyStatement({
        effect: _iam.Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:DescribeMountTargets',
          'elasticfilesystem:DescribeAccessPoints',
        ],
        resources: [
          fileSystem.fileSystemArn,
          pkiFileSystemAccessPoint.accessPointArn,
          dataFileSystemAccessPoint.accessPointArn,
          backupFileSystemAccessPoint.accessPointArn,
        ],
      }),
    );

    const userData = _ec2.UserData.forLinux();
    userData.addCommands(
      shared.setMinionIdCommand(),
      `mount -t efs -o tls,accesspoint=${pkiFileSystemAccessPoint.accessPointId} ${fileSystem.fileSystemId} ${shared.dirPath.saltKeys}`,
      `mount -t efs -o tls,accesspoint=${dataFileSystemAccessPoint.accessPointId} ${fileSystem.fileSystemId} ${shared.dirPath.saltData}`,
      `mount -t efs -o tls,accesspoint=${backupFileSystemAccessPoint.accessPointId} ${fileSystem.fileSystemId} ${shared.dirPath.backup}`,
      `echo "${fileSystem.fileSystemId} ${shared.dirPath.saltKeys} efs _netdev,tls,accesspoint=${pkiFileSystemAccessPoint.accessPointId} 0 0" >> /etc/fstab`,
      `echo "${fileSystem.fileSystemId} ${shared.dirPath.saltData} efs _netdev,tls,accesspoint=${dataFileSystemAccessPoint.accessPointId} 0 0" >> /etc/fstab`,
      `echo "${fileSystem.fileSystemId} ${shared.dirPath.backup} efs _netdev,tls,accesspoint=${backupFileSystemAccessPoint.accessPointId} 0 0" >> /etc/fstab`,
      `systemctl restart salt-master`,
      `systemctl enable salt-master`,
      `systemctl restart salt-api`,
      `systemctl enable salt-api`,
      `systemctl restart salt-minion`,
      `systemctl enable salt-minion`,
      shared.installServiceCronCommand(),
      `startCWA`,
    );

    const launchTemplate = new _ec2.LaunchTemplate(this, `${shared.ASG_NAME.MASTER}LaunchTemplate`, {
      launchTemplateName: shared.ASG_NAME.MASTER,
      instanceMetadataTags: true,
      machineImage: _ec2.MachineImage.fromSsmParameter(shared.ssmParamNames.ami.amazonLinux2),
      instanceType: new _ec2.InstanceType(shared.INSTANCE_TYPE.T2MICRO),
      securityGroup: props.securityGroups.saltMasterAsg,
      role,
      userData,
    });

    const asg = new _autoscaling.AutoScalingGroup(this, `${shared.ASG_NAME.MASTER}Asg`, {
      autoScalingGroupName: shared.ASG_NAME.MASTER,
      launchTemplate: launchTemplate,
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.private,
      minCapacity: 0,
      maxCapacity: 3,
      healthCheck: _autoscaling.HealthCheck.elb({ grace: _cdk.Duration.seconds(90) }),
      cooldown: _cdk.Duration.minutes(5),
      updatePolicy: _autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: 1,
        minInstancesInService: 1,
        pauseTime: _cdk.Duration.minutes(3),
      }),
      groupMetrics: [_autoscaling.GroupMetrics.all()],
    });

    _cdk.Tags.of(asg).add(shared.TAG_NAME.NAME, shared.ASG_NAME.MASTER);
    _cdk.Tags.of(asg).add(shared.TAG_NAME.TIER, shared.INSTANCE_TIER.MASTER);
    _cdk.Tags.of(asg).add(shared.TAG_NAME.ENVIRONMENT, shared.appConfig.env);

    albListener.addTargets(`${shared.ASG_NAME.MASTER}AlbTarget`, {
      targets: [asg],
      priority: 30,
      conditions: [_albv2.ListenerCondition.httpHeader(shared.customHeader.name, [shared.customHeader.value])],
      targetGroupName: shared.ASG_NAME.MASTER,
      deregistrationDelay: _cdk.Duration.seconds(18),
      protocol: _albv2.ApplicationProtocol.HTTP,
      loadBalancingAlgorithmType: _albv2.TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
      slowStart: _cdk.Duration.seconds(30),
      healthCheck: {
        path: '/',
        enabled: true,
        unhealthyThresholdCount: 3,
        healthyThresholdCount: 3,
        interval: _cdk.Duration.seconds(30),
      },
    });

    asg.scaleOnCpuUtilization('SaltMasterClusterAsgCpuUtilizationScalingPolicy', {
      targetUtilizationPercent: 63,
      disableScaleIn: false,
    });
    asg.scaleOnRequestCount('SaltMasterClusterAsgRequestCountScalingPolicy', {
      targetRequestsPerMinute: 60,
    });
    asg.scaleOnSchedule('SaltMasterClusterAsgScheduleMorningScalingPolicy', {
      timeZone: 'Europe/Berlin',
      minCapacity: 1,
      maxCapacity: 3,
      // schedule: Schedule.expression('30 6 * * ? *'),
      schedule: _autoscaling.Schedule.cron({ hour: '6', minute: '30' }),
    });
    asg.scaleOnSchedule('SaltMasterClusterAsgScheduleNightScalingPolicy', {
      timeZone: 'Europe/Berlin',
      minCapacity: 0,
      maxCapacity: 0,
      schedule: _autoscaling.Schedule.cron({ hour: '23', minute: '59' }),
    });

    /*********
     * OUTPUTS
     *********/
    this.saltMaster = {
      fileSystem,
      pkiFileSystemAccessPoint,
      dataFileSystemAccessPoint,
      backupFileSystemAccessPoint,
    };
  }
}
