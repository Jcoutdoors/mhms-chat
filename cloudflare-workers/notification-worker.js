// Cloudflare Worker: cats-notifications
// URL: https://cats-notifications.jonathan-5ad.workers.dev
// Receives Stream "message.new" webhook events and sends email via Resend.
//
// Environment variables (set in Cloudflare > Worker > Settings > Variables):
//   RESEND_API_KEY  (type: Secret)  -- the Resend API key
//
// Stream webhook config: Stream Dashboard > the MHMS Cohort app > Overview >
//   Webhook & Event Configuration. Point the webhook URL at this worker and
//   subscribe ONLY to the "message.new" event.
//
// From address uses the verified subdomain notifications.nexgenrva.com in Resend.
//
// Routing:
//   @mark / @dr. mayfield  -> emails dr.mark.mayfield@gmail.com
//   @support / @help       -> emails jonathan@nexgenrva.com
// Both checks are independent; one message can trigger either, both, or neither.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response('Bad request', { status: 400 });
    }

    if (body.type !== 'message.new') {
      return new Response('Ignored', { status: 200 });
    }

    const message = body.message;
    const text = message?.text || '';
    const senderName = message?.user?.name || message?.user?.id || 'Someone';
    const channelName = body.channel?.name || body.channel_id || 'unknown';

    const sendEmail = async (to, subject, intro) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'CATS Program <no-reply@notifications.nexgenrva.com>',
          to: [to],
          subject,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
              <div style="background:#3b73d8;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
                <h2 style="margin:0;font-size:16px;font-weight:600;">${intro}</h2>
              </div>
              <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
                <p style="margin:0 0 8px;font-size:13px;color:#999;">Channel: <strong style="color:#333;">#${channelName}</strong></p>
                <p style="margin:0 0 16px;font-size:13px;color:#999;">From: <strong style="color:#333;">${senderName}</strong></p>
                <div style="background:#f4f4f4;border-left:3px solid #3b73d8;padding:14px 16px;border-radius:4px;font-size:15px;color:#1a1a1a;line-height:1.5;">
                  ${text}
                </div>
              </div>
            </div>
          `,
        }),
      });
      return res;
    };

    const results = [];

    // Mark's mentions
    if (/@(mark|dr\.?\s*mayfield)/i.test(text)) {
      const r = await sendEmail(
        'dr.mark.mayfield@gmail.com',
        `${senderName} mentioned you in #${channelName}`,
        'You were mentioned in the CATS Community'
      );
      results.push('mark:' + r.status);
    }

    // Support / help requests
    if (/@(support|help)/i.test(text)) {
      const r = await sendEmail(
        'jonathan@nexgenrva.com',
        `Support request from ${senderName} in #${channelName}`,
        'A support request came in from the CATS Community'
      );
      results.push('support:' + r.status);
    }

    return new Response('Processed ' + (results.join(', ') || 'no matches'), { status: 200 });
  }
};
