import { Construct } from 'constructs';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as shared from '@src/shared';

export interface IVpcSubnetSelections {
  public: _ec2.SubnetSelection;
  private: _ec2.SubnetSelection;
  isolated: _ec2.SubnetSelection;
}

export interface ISecurityGroups {
  outboundHttps: _ec2.SecurityGroup;
  saltMasterEfs: _ec2.SecurityGroup;
  saltMasterAsg: _ec2.SecurityGroup;
  saltMinionAsg: _ec2.SecurityGroup;
  saltApiAlb: _ec2.SecurityGroup;
  lambdaWithEfsAccess: _ec2.SecurityGroup;
  lambdaWithSaltApiAlbAccess: _ec2.SecurityGroup;
}

export class Network extends Construct {
  private readonly vpcCidr = '10.0.0.0/16';

  public vpc: _ec2.Vpc;
  public subnetSelections: IVpcSubnetSelections;
  public securityGroups: ISecurityGroups;

  constructor(scope: Construct) {
    super(scope, 'Network');

    /*********
     * VPC
     *********/
    const vpc = new _ec2.Vpc(scope, 'Vpc', {
      vpcName: `vpc-${shared.appConfig.project}-${shared.appConfig.env}`,
      ipAddresses: _ec2.IpAddresses.cidr(this.vpcCidr),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: `Public-${shared.appConfig.env}`,
          subnetType: _ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: true,
        },
        {
          name: `Isolated-${shared.appConfig.env}`,
          subnetType: _ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 22,
        },
        {
          name: `Private-${shared.appConfig.env}`,
          subnetType: _ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
      ],
    });

    vpc.addGatewayEndpoint('VpcS3GatewayEndpoint', { service: _ec2.GatewayVpcEndpointAwsService.S3 });
    vpc.addGatewayEndpoint('VpcDynamoDbGatewayEndpoint', { service: _ec2.GatewayVpcEndpointAwsService.DYNAMODB });

    /*********
     * SUBNET SELECTIONS
     *********/
    const subnetSelections: IVpcSubnetSelections = {
      public: vpc.selectSubnets({ subnetType: _ec2.SubnetType.PUBLIC }),
      isolated: vpc.selectSubnets({ subnetType: _ec2.SubnetType.PRIVATE_ISOLATED }),
      private: vpc.selectSubnets({ subnetType: _ec2.SubnetType.PRIVATE_WITH_EGRESS }),
    };

    /*********
     * SECURITY GROUPS
     *********/
    const outboundHttps = new _ec2.SecurityGroup(scope, 'OutboundHttpsSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `outbound-https-${shared.appConfig.env}`,
    });

    const saltMasterEfs = new _ec2.SecurityGroup(scope, 'SaltMasterEfsSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `salt-master-efs-${shared.appConfig.env}`,
    });

    const saltMasterAsg = new _ec2.SecurityGroup(scope, 'SaltMasterAsgSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `salt-master-asg-${shared.appConfig.env}`,
    });

    const saltMinionAsg = new _ec2.SecurityGroup(scope, 'SaltMinionAsgSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `salt-minion-asg-${shared.appConfig.env}`,
    });

    const saltApiAlb = new _ec2.SecurityGroup(scope, 'SaltApiAlbSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `salt-api-alb-${shared.appConfig.env}`,
    });

    const lambdaWithEfsAccess = new _ec2.SecurityGroup(scope, 'LambdaWithEfsAccessSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `lambda-efs-access-${shared.appConfig.env}`,
    });

    const lambdaWithSaltApiAlbAccess = new _ec2.SecurityGroup(scope, 'LambdaWithSaltApiAlbAccessSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `lambda-salt-api-alb-access-${shared.appConfig.env}`,
    });

    outboundHttps.connections.allowTo(_ec2.Peer.anyIpv4(), _ec2.Port.tcp(443));

    saltMasterEfs.connections.allowFrom(saltMasterAsg, _ec2.Port.tcp(2049));
    saltMasterEfs.connections.allowFrom(lambdaWithEfsAccess, _ec2.Port.tcp(2049));

    lambdaWithEfsAccess.connections.allowTo(_ec2.Peer.anyIpv4(), _ec2.Port.tcp(443));
    lambdaWithEfsAccess.connections.allowTo(saltMasterEfs, _ec2.Port.tcp(2049));

    lambdaWithSaltApiAlbAccess.connections.allowTo(_ec2.Peer.anyIpv4(), _ec2.Port.tcp(443));
    lambdaWithSaltApiAlbAccess.connections.allowTo(saltApiAlb, _ec2.Port.tcp(80)); // redirect rule (http->https)

    saltApiAlb.connections.allowFrom(lambdaWithSaltApiAlbAccess, _ec2.Port.tcp(80)); // redirect rule (http->https)
    saltApiAlb.connections.allowFrom(lambdaWithSaltApiAlbAccess, _ec2.Port.tcp(443));
    saltApiAlb.connections.allowTo(saltMasterAsg, _ec2.Port.tcp(80));

    [4505, 4506].forEach((saltPort) => {
      saltMinionAsg.connections.allowTo(saltMasterAsg, _ec2.Port.tcp(saltPort));
      saltMasterAsg.connections.allowTo(saltMasterAsg, _ec2.Port.tcp(saltPort));
      saltMasterAsg.connections.allowFrom(saltMasterAsg, _ec2.Port.tcp(saltPort));
      saltMasterAsg.connections.allowFrom(saltMinionAsg, _ec2.Port.tcp(saltPort));
    });

    saltMinionAsg.connections.allowTo(_ec2.Peer.anyIpv4(), _ec2.Port.tcp(443));

    saltMasterAsg.connections.allowFrom(saltApiAlb, _ec2.Port.tcp(80));
    saltMasterAsg.connections.allowTo(saltMasterEfs, _ec2.Port.tcp(2049));
    saltMasterAsg.connections.allowTo(_ec2.Peer.anyIpv4(), _ec2.Port.tcp(443));

    /*********
     * OUTPUTS
     *********/
    this.vpc = vpc;
    this.subnetSelections = subnetSelections;
    this.securityGroups = {
      outboundHttps,
      saltMasterEfs,
      saltMasterAsg,
      saltMinionAsg,
      saltApiAlb,
      lambdaWithEfsAccess,
      lambdaWithSaltApiAlbAccess,
    };
  }
}
