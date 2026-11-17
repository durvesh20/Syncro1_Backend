# Universal WhatsApp Talent Partner Visitor Tracking

## Architecture

The approved WhatsApp template currently uses a static URL:

`https://www.syncro1.com/auth/register/campaign/talent-partner`

A static URL does not identify the individual WhatsApp recipient and does not prove a button click. The browser therefore records a **landing-page arrival**. A recipient-specific click can only be attributed when WAPI/Meta supplies a dynamic URL token or a provider click webhook.

The browser loads one shared script from the platform backend:

`https://devapi.syncro1.com/tracking/wapi-tracking.js`

The script posts browser events to the same API origin:

- `POST https://devapi.syncro1.com/api/wapi-tracking/visitor`
- `POST https://devapi.syncro1.com/api/wapi-tracking/event` (only when a valid campaign token is present)

The Syncro1 platform backend relays these fixed paths server-to-server to the CRM backend:

- `POST /api/crm/communications/wapi/tracking/visitor`
- `POST /api/crm/communications/wapi/tracking/event`

The relay does not accept a caller-supplied destination host/path. It validates visitor ID, event ID, page path, and event type before forwarding. Browser requests never need to call the CRM UI host or expose the CRM backend port.

## Required backend environment

The platform backend and CRM backend are expected to be reachable over the same private host/network. Defaults are:

```env
CRM_INTERNAL_HOST=127.0.0.1
CRM_INTERNAL_PORT=5001
```

If the CRM backend listens on another private host/port, set these values to that actual internal address. Do not use the CRM frontend UI port (3001) as the CRM API backend port.

The CRM backend defaults to port 5001 in its server configuration. Confirm the actual running process and listening port on the VPS before deployment.

## Include the script on the real landing page

The script must be included by the application that actually serves:

`https://www.syncro1.com/auth/register/campaign/talent-partner`

For a Next.js page/layout, load it only on this route using `next/script`:

```jsx
import Script from 'next/script';

// Inside the page/layout for /auth/register/campaign/talent-partner:
<Script
  src="https://devapi.syncro1.com/tracking/wapi-tracking.js"
  strategy="afterInteractive"
/>
```

For the Vite/React reference copy, it can be loaded in the route component with a script element or dynamically. The script self-checks `window.location.pathname` and exits on all other routes.

Do not add this script only to the CRM admin UI. The CRM branch `syncro1-frontend-copy` is a reference copy; it is not proof of the production Next.js source location. The production webapp repository/deployment still needs the one-time inclusion above.

## Events and lead matching

1. `LANDING_PAGE_ARRIVED`: creates an anonymous `STAFFING_PARTNER` lead in CRM, keyed by browser `visitorId`.
2. The browser attaches the same `visitorId` to the registration-init request body.
3. The platform backend registration controller forwards `REGISTRATION_STARTED` and `REGISTRATION_COMPLETED` to CRM using the same visitor ID. This avoids sending duplicate registration-start events from both browser and backend.
4. CRM updates the existing visitor lead instead of creating a second lead, then adds journey/activity history.

The platform backend currently exposes the registration-init route as `/api/auth/register/staffing-partner/init`. The copied Vite frontend reference calls `/api/auth/register/talent-partner/init`; verify the production webapp's actual API path before assuming those routes are interchangeable.

## Deployment and verification

1. Deploy the platform backend branch after review/merge.
2. Confirm `https://devapi.syncro1.com/api/health` is healthy.
3. Confirm CRM backend is listening at the configured private host/port and `/api/crm/ping` responds locally.
4. Add the one-time script include to the actual Next.js landing page source and deploy that webapp.
5. Open the exact Talent Partner landing page in a fresh browser profile. Confirm one anonymous visitor appears in CRM All Leads.
6. Submit a test registration. Confirm the same lead is enriched with name/email/mobile and receives registration lifecycle events; verify there is no second lead for the same visitor ID.
7. Reload the page and confirm the same browser visitor does not create a duplicate arrival event for that tab.
8. Test from an internal opted-in WhatsApp number before any external campaign.

## Limitations

- Static WhatsApp template URL: landing arrival is measurable; verified button click and recipient-level attribution are not.
- Dynamic URL token/provider click webhook: required for recipient-specific click attribution.
- Browser storage restrictions/private browsing may prevent persistent visitor IDs; registration still needs to carry the visitor ID generated on that visit.
