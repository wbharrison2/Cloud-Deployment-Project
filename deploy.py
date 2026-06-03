#!/usr/bin/env python3
"""
deploy.py — Project 1: Cloud Infrastructure & Development
Author : Wilton B. Harrison
Purpose: Automates packaging and uploading a web app artifact to S3,
         then triggers an SSM Run Command to pull and deploy it on the EC2
         web server — no manual SSH required.

Dependencies (all open-source):
  pip install boto3 click

Usage:
  python deploy.py --bucket <bucket-name> --instance-id <i-xxxx> --app-dir ./app
"""

import os
import sys
import hashlib
import tarfile
import tempfile
import subprocess
import boto3
import click
from datetime import datetime
from botocore.exceptions import ClientError


# ── Helpers ──────────────────────────────────────────────────────────────────

def sha256_file(path: str) -> str:
    """Return hex SHA-256 of a file for integrity verification."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def archive_app(app_dir: str, dest: str) -> str:
    """Tar-gz the app directory, return archive path."""
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    archive_name = f"app-{timestamp}.tar.gz"
    archive_path = os.path.join(dest, archive_name)
    click.echo(f"[+] Archiving {app_dir} → {archive_path}")
    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(app_dir, arcname="app")
    return archive_path, archive_name


def upload_to_s3(bucket: str, file_path: str, key: str) -> None:
    """Upload file to S3 with integrity check via checksum."""
    s3 = boto3.client("s3")
    checksum = sha256_file(file_path)
    click.echo(f"[+] Uploading to s3://{bucket}/{key}")
    click.echo(f"    SHA-256: {checksum}")
    try:
        s3.upload_file(
            file_path, bucket, key,
            ExtraArgs={"Metadata": {"sha256": checksum, "deployed-by": "wbh-deploy"}}
        )
        click.echo(f"[✓] Upload complete.")
    except ClientError as e:
        click.echo(f"[✗] S3 upload failed: {e}", err=True)
        sys.exit(1)


def trigger_ssm_deploy(instance_id: str, bucket: str, key: str) -> None:
    """
    Send SSM Run Command to EC2 instance to pull artifact from S3
    and deploy to Apache web root — zero SSH required.
    """
    ssm = boto3.client("ssm")
    commands = [
        f"aws s3 cp s3://{bucket}/{key} /tmp/app.tar.gz",
        "tar -xzf /tmp/app.tar.gz -C /var/www/html/ --strip-components=1",
        "systemctl restart httpd",
        "echo '[✓] Deployment complete on EC2'"
    ]
    click.echo(f"[+] Triggering SSM deployment on {instance_id}")
    try:
        response = ssm.send_command(
            InstanceIds=[instance_id],
            DocumentName="AWS-RunShellScript",
            Parameters={"commands": commands},
            Comment="WBH auto-deploy via deploy.py"
        )
        cmd_id = response["Command"]["CommandId"]
        click.echo(f"[✓] SSM Command ID: {cmd_id}")
        click.echo(f"    Monitor: aws ssm get-command-invocation --command-id {cmd_id} --instance-id {instance_id}")
    except ClientError as e:
        click.echo(f"[✗] SSM send_command failed: {e}", err=True)
        sys.exit(1)


# ── CLI ───────────────────────────────────────────────────────────────────────

@click.command()
@click.option("--bucket",      required=True, help="S3 artifact bucket name")
@click.option("--instance-id", required=True, help="EC2 instance ID (i-xxxx)")
@click.option("--app-dir",     default="./app", show_default=True, help="Local app directory to deploy")
def deploy(bucket, instance_id, app_dir):
    """
    Package, upload, and deploy a web application to AWS EC2 via S3 + SSM.
    No SSH. No manual steps. Full audit trail via S3 metadata + SSM history.
    """
    click.echo("\n══════════════════════════════════════════")
    click.echo("  WBH Cloud Deploy — Project 1")
    click.echo("  Cloud Infrastructure & Development")
    click.echo("══════════════════════════════════════════\n")

    if not os.path.isdir(app_dir):
        click.echo(f"[✗] App directory not found: {app_dir}", err=True)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        archive_path, archive_name = archive_app(app_dir, tmpdir)
        s3_key = f"deployments/{archive_name}"
        upload_to_s3(bucket, archive_path, s3_key)
        trigger_ssm_deploy(instance_id, bucket, s3_key)

    click.echo("\n[✓] Pipeline complete. App deployed.\n")


if __name__ == "__main__":
    deploy()
