import { Construct } from 'constructs';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as _autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

interface ISaltMinionProps {
  kmsKey: _kms.Key;
  vpc: _ec2.Vpc;
  subnetSelections: constructs.IVpcSubnetSelections;
  securityGroups: constructs.ISecurityGroups;
}

export class SaltMinion extends Construct {
  constructor(scope: Construct, props: ISaltMinionProps) {
    super(scope, 'SaltMinion');

    /*********
     * LAUNCH TEMPLATE
     *********/
    const roleName = `${shared.ASG_NAME.MINION}-instance-role`;
    const role = new _iam.Role(this, roleName, {
      roleName,
      assumedBy: new _iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    props.kmsKey.grantEncryptDecrypt(role);
    role.addManagedPolicy(_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    role.addToPolicy(shared.cwAgentPolicy);

    const userData = _ec2.UserData.forLinux();
    userData.addCommands(
      shared.setMinionIdCommand(),
      `systemctl restart salt-minion`,
      `systemctl enable salt-minion`,
      shared.installServiceCronCommand(),
      `startCWA`,
    );

    const launchTemplate = new _ec2.LaunchTemplate(this, `${shared.ASG_NAME.MINION}LaunchTemplate`, {
      launchTemplateName: shared.ASG_NAME.MINION,
      instanceMetadataTags: true,
      machineImage: _ec2.MachineImage.fromSsmParameter(shared.ssmParamNames.ami.amazonLinux2),
      instanceType: new _ec2.InstanceType(shared.INSTANCE_TYPE.T2MICRO),
      securityGroup: props.securityGroups.saltMinionAsg,
      role,
      userData,
    });

    const asg = new _autoscaling.AutoScalingGroup(this, `${shared.ASG_NAME.MINION}Asg`, {
      autoScalingGroupName: shared.ASG_NAME.MINION,
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

    _cdk.Tags.of(asg).add(shared.TAG_NAME.NAME, shared.ASG_NAME.MINION);
    _cdk.Tags.of(asg).add(shared.TAG_NAME.TIER, shared.INSTANCE_TIER.MINION);
    _cdk.Tags.of(asg).add(shared.TAG_NAME.ENVIRONMENT, shared.appConfig.env);

    asg.scaleOnCpuUtilization('SaltMinionClusterAsgCpuUtilizationScalingPolicy', {
      targetUtilizationPercent: 63,
      disableScaleIn: false,
    });

    asg.scaleOnSchedule('SaltMinionClusterAsgScheduleNightScalingPolicy', {
      timeZone: 'Europe/Berlin',
      minCapacity: 0,
      maxCapacity: 0,
      schedule: _autoscaling.Schedule.cron({ hour: '23', minute: '59' }),
    });
  }
}
