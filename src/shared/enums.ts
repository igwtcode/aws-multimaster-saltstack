export enum TAG_NAME {
  PROJECT = 'Project',
  ENVIRONMENT = 'Environment',
  SOURCE = 'Source',
  TIER = 'Tier',
  NAME = 'Name',
}

export enum INSTANCE_TYPE {
  T2MICRO = 't2.micro',
}

export enum INSTANCE_TIER {
  MASTER = 'salt-master',
  MINION = 'salt-minion',
}

export enum ReplicationDestinationStorageClass {
  STANDARD = 'STANDARD',
  STANDARD_IA = 'STANDARD_IA',
  ONEZONE_IA = 'ONEZONE_IA',
  INTELLIGENT_TIERING = 'INTELLIGENT_TIERING',
  GLACIER = 'GLACIER',
  REDUCED_REDUNDANCY = 'REDUCED_REDUNDANCY',
  DEEP_ARCHIVE = 'DEEP_ARCHIVE',
  OUTPOSTS = 'OUTPOSTS',
}

export enum ReplicationRuleStatus {
  ENABLED = 'Enabled',
  DISABLED = 'Disabled',
}
