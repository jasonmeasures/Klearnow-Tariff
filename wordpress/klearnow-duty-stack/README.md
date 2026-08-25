# KlearNow Duty Stack — WordPress embed

Install this folder as a WordPress plugin (`wp-content/plugins/klearnow-duty-stack/`).

## Shortcode

```
[klearnow_duty_stack]
[klearnow_duty_stack height="800" url="https://YOUR_SPA/?embed=1&surface=external"]
```

## What external users see

- Duty stack only (no HTS list / Audit / Chat / CSMS / admin)
- Guest allowance: **5 stacks / day**, **2 extracts / day**
- **Sign in (Auth0) → unlimited** stacks and extracts
- Admin role still never exposed through the embed chrome

## Backend env (API hosting the SPA)

```
APP_SURFACE=external
ALLOW_GUEST=true
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.klearnow.com/tariff
FRAME_ANCESTORS='self' https://your-wordpress.example https://*.klearnow.com
QUOTA_ANON_STACKS=5
QUOTA_ANON_EXTRACTS=2
```

## Frontend env (Amplify / SPA)

```
VITE_SURFACE=external
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=...
VITE_AUTH0_AUDIENCE=https://api.klearnow.com/tariff
```

Mark users as admin via Auth0 custom claim `https://klearnow.com/roles` including `admin` (playground / engine only — not for marketing WordPress users).
