#!/bin/bash

cp /etc/fstab /etc/fstab.orig
cp /etc/sudoers /etc/sudoers.orig

yum update -y
yum install amazon-linux-extras amazon-efs-utils -y
amazon-linux-extras install epel -y
rpm --import https://repo.saltproject.io/salt/py3/amazon/2/x86_64/latest/SALTSTACK-GPG-KEY.pub
curl -fsSL https://repo.saltproject.io/salt/py3/amazon/2/x86_64/latest.repo | tee /etc/yum.repos.d/salt-amzn.repo
yum clean expire-cache
yum update -y
amazon-linux-extras enable python3.8
yum groupinstall -y "Development Tools"
yum install -y openssl11 openssl11-devel libffi-devel bzip2-devel xfsprogs htop vim curl wget unzip python3 git

amazon-linux-extras install -y python3.8
rm -f /usr/bin/python3
ln -s /usr/bin/python3.8 /usr/bin/python3

pip3 install --upgrade pip
pip3 install CherryPy==18.8.0
pip3 install pyOpenSSL==22.1.0
pip3 install GitPython==3.1.29

yum install -y amazon-cloudwatch-agent salt-minion salt-master salt-api 

curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install
sudo ln -s -f /usr/local/bin/aws /usr/bin/aws
rm -f awscliv2.zip
rm -rf aws
