# What Changed — Enterprise Project 4
## Simple Explanation of Upgrades from Project 1

**Source project this is based on:** Project 1 — Cloud Infrastructure & Development
*(https://github.com/wbharrison2/Cloud-Deployment-Project)*

---

## What Project 1 Did (The Starting Point)

Project 1 built a basic web server setup on AWS. Think of it like setting up one computer in one room to serve a website. It had:
- One server (EC2 computer) running a web app
- Three separate network areas (public, private, database) for security
- A storage bucket (S3) for keeping files
- Basic security: no direct internet access to the server, locked-down access rules

That's a great foundation, but it has one big weakness: **if that one computer or that one room (AWS region) goes down, your website goes down too.**

---

## What Enterprise Project 4 Does (The Upgrade)

This project keeps everything from Project 1 but adds the features that large businesses need to stay running 24/7.

---

### Change 1: Two Locations Instead of One

**Before:** Everything in one AWS region (us-east-1, Virginia).

**Now:** The app runs in TWO locations — Virginia (primary) and Oregon (backup). If Virginia has a problem, Oregon automatically takes over within about 90 seconds. Your users never notice anything happened.

**Why it matters:** Big companies can't afford downtime. Every minute down can cost thousands of dollars and damage customer trust.

---

### Change 2: A Group of Computers Instead of One

**Before:** One server. If it gets overloaded or crashes, the website stops working.

**Now:** An Auto Scaling Group — a team of 2 to 20 servers that automatically grows or shrinks based on how busy the website is. If a server dies, the group automatically replaces it. If traffic spikes, it adds more servers automatically.

**Why it matters:** Enterprise apps need to handle unpredictable traffic (like a product launch or a news event) without crashing.

---

### Change 3: A Real Database with Backup

**Before:** No database was included.

**Now:** A PostgreSQL database (RDS) that runs in TWO availability zones at the same time. If the main database has a problem, it automatically switches to the backup copy — users don't lose data or experience downtime. There's also a read-only copy in Oregon as an extra safety net.

**Why it matters:** Most apps store data. Losing your database means losing your business.

---

### Change 4: A Global Content Delivery Network (CDN)

**Before:** Users far from Virginia got slow load times.

**Now:** CloudFront serves the app from edge locations around the world — London, Tokyo, São Paulo, etc. Users connect to the closest location. Pages load faster for everyone.

**Why it matters:** Speed matters for user experience and SEO rankings.

---

### Change 5: Website Attack Protection (WAF)

**Before:** No firewall protection against web attacks.

**Now:** A Web Application Firewall (WAF) with three protective layers:
- Blocks common web attacks (SQL injection, cross-site scripting) — the OWASP Top 10
- Blocks known bad input patterns
- Automatically cuts off any single IP address that sends too many requests (rate limiting)

**Why it matters:** The internet is constantly probed for vulnerabilities. The WAF stops most attacks before they even reach the app.

---

### Change 6: Files Replicated Automatically

**Before:** Files stored in one S3 bucket in Virginia. If Virginia is down, files are inaccessible.

**Now:** Files are automatically copied to an identical S3 bucket in Oregon. If Virginia goes down, Oregon has all the same files ready.

**Why it matters:** Data availability is just as important as server availability.

---

### Change 7: Passive Monitoring — Watching Everything

**Before:** No monitoring or alerting.

**Now:** CloudWatch dashboards show live graphs of:
- How many servers are running
- How fast the website responds (P95 and P99 speed)
- How many requests are coming in vs. how many are failing
- Database health and storage space

**Alarms automatically send email** when something goes wrong — CPU too high, servers unhealthy, too many errors, database running out of space.

**Why it matters:** You can't fix what you can't see. Monitoring tells you about problems before customers call to complain.

---

### Change 8: Active Monitoring — Automatic Threat Response

**Before:** No security monitoring.

**Now:** GuardDuty constantly watches for signs of attack or compromise (unusual logins, suspicious network activity, malware). When it finds something serious (HIGH or CRITICAL threat), a Lambda function *automatically* stops the affected server and tags it as quarantined — all within 60 seconds, with no human needed.

**Why it matters:** Cyber attacks move fast. Waiting for a human to respond can mean the difference between a contained incident and a full breach.

---

### Change 9: Stronger Encryption

**Before:** Standard AWS encryption (AES-256 managed by AWS).

**Now:** Customer-Managed KMS Key (CMK) — you control the encryption key, not AWS. The key automatically rotates every year. Everything is encrypted: servers, database, files, alerts, and log data.

**Why it matters:** Regulatory compliance (HIPAA, PCI-DSS, SOC2) often requires you to control your own encryption keys.

---

## Summary Table

| What Changed | Simple Version | Business Reason |
|---|---|---|
| Two AWS regions | Two buildings instead of one | If one burns down, the other keeps running |
| Auto Scaling Group | A team that grows/shrinks automatically | Handle any amount of traffic without crashing |
| RDS Multi-AZ database | Database with automatic backup twin | Never lose data, even if a server fails |
| CloudFront CDN | Copies of your website around the world | Faster loading for all users everywhere |
| WAF protection | Security guard blocking bad actors | Stop web attacks automatically |
| S3 cross-region replication | Files copied to backup location | Files always available even during outages |
| CloudWatch dashboards/alarms | Live health display + email alerts | Know about problems before users do |
| GuardDuty + Lambda | Security guard that auto-locks threats | Stop attackers within 60 seconds, automatically |
| KMS encryption keys | You own your own locks and keys | Meet strict security compliance requirements |

---

*This project demonstrates enterprise-grade AWS architecture patterns used by companies like Netflix, Airbnb, and major financial institutions.*
