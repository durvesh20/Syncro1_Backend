const { buildTrackingRequests } = require('../utils/wapiTracking');

describe('WAPI registration tracking request builder', () => {
  const visitorId = 'visitor_1234567890';
  const campaignKey = 'a'.repeat(64);

  test('sends static-template lifecycle events to the anonymous visitor endpoint', () => {
    const requests = buildTrackingRequests('REGISTRATION_STARTED', { visitorId }, 'event-static-1');

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/crm/communications/wapi/tracking/visitor');
    expect(requests[0].payload).toMatchObject({
      visitorId,
      eventId: 'event-static-1',
      eventType: 'REGISTRATION_STARTED',
      pagePath: '/auth/register/campaign/talent-partner'
    });
  });

  test('sends visitor lifecycle and campaign analytics when campaign attribution exists', () => {
    const requests = buildTrackingRequests('REGISTRATION_COMPLETED', {
      visitorId,
      utm_campaign: campaignKey,
      wapi_recipient: 'recipient-token'
    }, 'event-campaign-1');

    expect(requests).toHaveLength(2);
    expect(requests[0].path).toBe('/api/crm/communications/wapi/tracking/visitor');
    expect(requests[1].path).toBe('/api/crm/communications/wapi/tracking/event');
    expect(requests[1].payload).toMatchObject({
      visitorId,
      eventId: 'event-campaign-1',
      eventType: 'REGISTRATION_COMPLETED',
      campaignKey,
      recipientToken: 'recipient-token'
    });
  });

  test('does not send requests for invalid visitor IDs or unsupported event types', () => {
    expect(buildTrackingRequests('REGISTRATION_STARTED', { visitorId: 'short' })).toEqual([]);
    expect(buildTrackingRequests('BUTTON_CLICKED', { visitorId })).toEqual([]);
  });
});
