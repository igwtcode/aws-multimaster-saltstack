import { MD5 } from 'object-hash';
import * as path from 'path';
import * as fs from 'fs';
import * as shared from '@src/shared';

export function getBucketName(baseName: string): string {
  if (!(baseName.length > 3 && !baseName.startsWith('-') && !baseName.endsWith('-')))
    throw Error('invalid bucket name');
  let name = `${baseName}-${MD5(baseName + shared.appConfig.account + shared.appConfig.env)}`.toLowerCase().trim();
  name = name.substring(0, 62); // max 63 characters
  return name;
}

type ScriptName = 'api' | 's3_sync' | 'imagebuilder_pipeline_exec';
type ScriptSubstitutionKey =
  | 'SALT_MASTER_BUCKET_NAME'
  | 'IMAGEBUILDER_SALT_MASTER_BUCKET_NAME'
  | 'IMAGEBUILDER_SALT_MINION_BUCKET_NAME'
  | 'IMAGEBUILDER_SALT_MASTER_ARN'
  | 'IMAGEBUILDER_SALT_MINION_ARN'
  | 'XAPIKEY'
  | 'API_DOMAIN_NAME';
export interface ScriptSubstitution {
  key: ScriptSubstitutionKey;
  value: string;
}
export function setValueInScript(scriptName: ScriptName, substitution: ScriptSubstitution[]) {
  const scriptPath = path.join(__dirname, '..', 'scripts', `${scriptName}.sh`);
  let content = fs.readFileSync(scriptPath, { encoding: 'utf-8' });
  substitution.forEach((subs) => {
    content = content.replace(new RegExp(`${subs.key}=".*"`), `${subs.key}="${subs.value}"`);
  });
  fs.writeFileSync(scriptPath, content);
}

export class ARN {
  public static ssmParameter(paramName: string) {
    return `arn:aws:ssm:${shared.appConfig.region}:${shared.appConfig.account}:parameter${paramName}`;
  }
  public static role(roleName: string) {
    return `arn:aws:iam::${shared.appConfig.account}:role/${roleName}`;
  }
  public static s3Bucket(bucketName: string) {
    return `arn:aws:s3:::${bucketName}`;
  }
  public static codeCommitRepo(repoName: string) {
    return `arn:aws:codecommit:${shared.appConfig.region}:${shared.appConfig.account}:${repoName}`;
  }
  public static snsTopic(topicname: string) {
    return `arn:aws:sns:${shared.appConfig.region}:${shared.appConfig.account}:${topicname}`;
  }
  public static efs(efsId: string) {
    return `arn:aws:elasticfilesystem:${shared.appConfig.region}:${shared.appConfig.account}:file-system/${efsId}`;
  }
  public static stack(stackName: string) {
    return `arn:aws:cloudformation:${shared.appConfig.region}:${shared.appConfig.account}:stack/${stackName}/*`;
  }
  public static imageBuilderPipeline(pipelineName: string) {
    return `arn:aws:imagebuilder:${shared.appConfig.region}:${shared.appConfig.account}:image-pipeline/${pipelineName}`;
  }
}

const metaDataUrl = 'http://169.254.169.254/latest/meta-data';
export const setMinionIdCommand = () =>
  `echo "id: $(wget -qO- ${metaDataUrl}/tags/instance/Name)_$(wget -qO- ${metaDataUrl}/instance-id)" > ${shared.filePath.saltMinion.id}`;
export const installServiceCronCommand = () =>
  `echo "* * * * * root /bin/bash ${shared.filePath.scripts.serviceCron}" > ${shared.dirPath.cron}/service_cron`;
