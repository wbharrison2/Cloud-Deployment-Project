# Project 4 — Franchise High-Availability Platform
## Artisan Gem Works | Multi-Location E-Commerce

> **Scenario context:** After outgrowing the single-node Portland setup, Artisan Gem Works opened a Seattle location in September 2023. Black Friday 2023 brought a 14-hour outage and $28,400 in lost revenue. This project documents the migration to a high-availability, multi-location platform.

---

## What's New vs. Project 3

| Area | Project 3 | Project 4 |
|------|-----------|----------|
| Database | SQLite (WAL) | PostgreSQL 15 (RDS Multi-AZ) |
| Compute | 1 ECS task | 2 ECS tasks (desired_count=2) |
| Cache | Redis sidecar | ElastiCache Redis (managed) |
| Locations | Portland only | Portland + Seattle |
| Session state | httpOnly cookie (stateless JWT) | Same — no sticky sessions needed |
| Auth | Cookie + TOTP 2FA | Same + shared across both locations |
| Deployment | Single-region | Multi-AZ within us-west-2 |

---

## Architecture

```
Users
  │
  ▼
CloudFront (WAF + CDN)
  │
  ▼
ALB (multi-AZ, health checks)
  ├─► ECS Task A  (us-west-2a)
  └─► ECS Task B  (us-west-2b)
         │
         ├─► RDS PostgreSQL Primary  (us-west-2a) ─► Read Replica (us-west-2b)
         └─► ElastiCache Redis       (multi-AZ cluster mode disabled)
```

---

## Store Locations

### Portland (Flagship)
- **Address:** 2847 NW Thurman St, Portland, OR 97210
- **Phone:** (503) 555-0142
- **Hours:** Tue–Sat 10am–7pm | Sun 11am–5pm | Mon Closed
- **Manager:** Mira Chen

### Seattle
- **Address:** 4521 Ballard Ave NW, Seattle, WA 98107
- **Phone:** (206) 555-0178
- **Hours:** Mon–Sat 10am–8pm | Sun 12pm–6pm
- **Manager:** Priya Okafor

---

## Product Catalog

### Shared (both locations — 10 items)
| Name | Price |
|------|-------|
| Cascade Falls Ring | $145 |
| Forest Mist Pendant | $98 |
| Obsidian Coast Cuff | $175 |
| Pacific Tide Earrings | $65 |
| Evergreen Lariat | $130 |
| Basalt Column Brooch | $88 |
| River Stone Bracelet | $75 |
| Alpine Meadow Ring | $120 |
| Coastal Fog Pendant | $110 |
| Northwest Moss Ring | $85 |

### Portland Exclusive (pdx- prefix)
| Name | Price |
|------|-------|
| Columbia Gorge Cuff | $165 |
| Mt. Hood Crystal Set | $220 |
| Willamette Valley Vine | $95 |

### Seattle Exclusive (sea- prefix)
| Name | Price |
|------|-------|
| Puget Sound Wave Ring | $155 |
| Rainier Summit Pendant | $195 |
| Pike Market Mosaic | $115 |

---

## Quick Start

```bash
cp .env.example .env
# Fill in DB_PASSWORD, JWT_SECRET, COOKIE_SECRET, TOTP_ISSUER
docker compose up --build
# Visit http://localhost
# Admin: http://localhost/admin.html
```

**First-time DB seed:**
```bash
docker compose exec app node db/seed.js
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/locations | List all store locations |
| GET | /api/products | Products (optional ?location=pdx\|sea) |
| GET | /api/products/:slug | Single product |
| GET | /api/products/categories | All categories |
| POST | /api/auth/login | Login (returns cookie + 2FA flag) |
| POST | /api/auth/2fa/verify | Verify TOTP code |
| POST | /api/auth/logout | Revoke JWT (Redis blocklist) |
| GET | /api/auth/me | Current user |
| POST | /api/orders | Place order (requires location) |
| GET | /api/orders/mine | Customer order history |
| GET | /api/admin/orders | All orders (admin) |
| PATCH | /api/admin/orders/:id | Update order status |
| POST/PUT/DELETE | /api/admin/products | Product CRUD |
| GET | /api/admin/audit-log | Paginated audit events |
| POST | /api/admin/cache/clear | Flush Redis + CloudFront |

---

## Security Controls (inherited from P3 + additions)

| Control | Implementation |
|---------|---------------|
| JWT auth | httpOnly `__Host-agw_token` cookie |
| 2FA | TOTP via speakeasy (RFC 6238) |
| Session revocation | Redis blocklist with TTL |
| Audit log | PostgreSQL audit_log table |
| Rate limiting | Nginx: 5r/m auth, 5r/m admin |
| HSTS | max-age=63072000; includeSubDomains |
| CSP | Strict policy, no inline scripts |
| WAF | AWS WAFv2 managed rules + rate limit |
| TLS | ACM cert, TLSv1.2_2021 minimum |
| DB encryption | RDS storage encryption (AES-256) |

---

## Environment Variables

See `.env.example` for full list. Critical vars:

```
DATABASE_URL   postgresql://agw:PASSWORD@host:5432/agw
JWT_SECRET     64-char random hex
COOKIE_SECRET  32-char random hex
REDIS_URL      redis://elasticache-endpoint:6379
STRIPE_SECRET_KEY  sk_test_...
```

---

## Deployment

```bash
export ECR_REPO=123456789.dkr.ecr.us-west-2.amazonaws.com/agw-p4
export CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXX
bash deploy.sh
```
