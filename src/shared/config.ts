import { INSTANCE_TIER } from './enums';

export const appConfig = {
  account: process.env.ACCOUNT_ID!,
  domain: process.env.DOMAIN!,
  appApiKey: process.env.API_KEY!,
  username: process.env.CDK_IAM_USER!,
  email: process.env.EMAIL!,
  region: process.env.REGION || 'us-east-1',
  saltApiUser: process.env.SALT_API_USER || 'saltuser',
  saltApiPassword: process.env.SALT_API_PASSWORD || 'saltPassword',
  privateSubDomainName: 'internal',
  env: 'dev',
  project: 'Salt',
};

export const domainNames = {
  private: `${appConfig.privateSubDomainName}.${appConfig.domain}`,
  saltApi: `salt-${appConfig.env}.${appConfig.privateSubDomainName}.${appConfig.domain}`,
  appApi: `api-${appConfig.env}.${appConfig.domain}`,
};

export const ASG_NAME = {
  MASTER: `${INSTANCE_TIER.MASTER}-cluster-${appConfig.env}`,
  MINION: `${INSTANCE_TIER.MINION}-demo-cluster-${appConfig.env}`,
} as const;
type ASG_NAME_KEYS = keyof typeof ASG_NAME;
export type ASG_NAME = typeof ASG_NAME[ASG_NAME_KEYS];

export const instanceInfoTableConfig = {
  tableName: `instance-info-${appConfig.env}`,
  partionKey: 'instance_id',
  ttlAttr: 'del_record_at',
};

export const ssmParamNames = {
  ami: {
    amazonLinux2: '/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2',
    saltMaster: `/${appConfig.env}/ami/salt-master`,
    saltMinion: `/${appConfig.env}/ami/salt-minion`,
  },
  credentials: {
    saltApiUsername: `/${appConfig.env}/credentials/salt-api/username`,
    saltApiPassword: `/${appConfig.env}/credentials/salt-api/password`,
  },
};

export const dirPath = {
  home: '/home/ec2-user',
  scripts: '/scripts',
  backup: '/srv/backup',
  saltData: '/srv/salt/data',
  saltKeys: '/etc/salt/pki/master',
  cron: '/etc/cron.d',
};

export const filePath = {
  cwAgentConf: '/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json',
  scripts: {
    userBashProfile: `${dirPath.home}/.bash_profile`,
    rootBashProfile: `/root/.bash_profile`,
    install: `${dirPath.scripts}/install.sh`,
    serviceCron: `${dirPath.scripts}/service-cron.sh`,
  },
  saltMaster: {
    conf: '/etc/salt/master.d/master.conf',
    apiAccessLog: '/var/log/salt/api_access_log',
    apiErrorLog: '/var/log/salt/api_error_log',
  },
  saltMinion: {
    id: '/etc/salt/minion.d/id.conf',
    master: '/etc/salt/minion.d/master.conf',
  },
};

export const customHeader = {
  name: 'X-Custom-Header',
  value: 'customHeaderToBeSetInRequestsFromApiGWToSaltApiAlb',
};
