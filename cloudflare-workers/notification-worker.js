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
//   @mark / @dr. mayfield / @dr. mark mayfield  -> emails dr.mark.mayfield@gmail.com
//   @support / @help       -> emails jonathan@nexgenrva.com
// Both checks are independent; one message can trigger either, both, or neither.
// Mention patterns require the character before "@" to NOT be a typical email
// local-part character, so an address like jon@support.org does not false-trigger
// the support route (v61 fix).

// The chat URL. The "Respond in the Chat" button opens General (kept simple and reliable).
const CHAT_URL = 'https://chat.mentalhealthmadesimple.life';

// Map channel IDs to friendly display names so the email reads nicely even if the
// webhook only includes the raw channel_id. Keep in sync with APP_CONFIG.channelGroups
// in the app (index.jsx).
const CHANNEL_NAMES = {
  'cats-announcements': '📣 Announcements',
  'cats-general': 'General',
  'cats-weekly-wins': 'Weekly Wins',
  'cats-readings': 'Readings & Resources',
  'cats-mod-01': 'Mod 1 · Development & Neuroscience',
  'cats-mod-02': 'Mod 2 · Attachment Theory',
  'cats-mod-03': 'Mod 3 · Trauma, ACEs & PTSD',
  'cats-mod-04': 'Mod 4 · Therapeutic Presence',
  'cats-mod-05': 'Mod 5 · CBT, DBT & ACT',
  'cats-mod-06': 'Mod 6 · TF-CBT, EMDR & MI',
  'cats-mod-07': 'Mod 7 · Crisis Intervention',
  'cats-mod-08': 'Mod 8 · Family Systems',
  'cats-mod-09': 'Mod 9 · Identity, Culture & Tech',
  'cats-mod-10': 'Mod 10 · Supervised Practice',
};
function friendlyChannel(id, fallbackName) {
  return CHANNEL_NAMES[id] || fallbackName || id || 'the chat';
}

// Escapes a value for safe insertion into the HTML email body. Applied to every
// piece of user-generated or channel-derived text before it goes into the template
// (v61 fix; previously senderName/channelName/text went in unescaped).
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

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
    const channelId = body.channel_id || (body.cid ? String(body.cid).replace('messaging:', '') : '');
    const channelName = friendlyChannel(channelId, body.channel?.name);

    // Escaped versions for HTML interpolation. The raw (unescaped) values are still
    // used for the mention-pattern checks below, since those run against plain text.
    const safeSenderName = escapeHtml(senderName);
    const safeChannelName = escapeHtml(channelName);
    const safeText = escapeHtml(text);

    const sendEmail = async (to, subject, intro, contextLine) => {
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
                <p style="margin:0 0 8px;font-size:14px;color:#1a1a1a;">${contextLine}</p>
                <p style="margin:0 0 16px;font-size:13px;color:#999;">From: <strong style="color:#333;">${safeSenderName}</strong></p>
                <div style="background:#f4f4f4;border-left:3px solid #3b73d8;padding:14px 16px;border-radius:4px;font-size:15px;color:#1a1a1a;line-height:1.5;">
                  ${safeText}
                </div>
                <div style="margin-top:20px;">
                  <a href="${CHAT_URL}" target="_blank" rel="noopener noreferrer"
                    style="display:inline-block;background:#3b73d8;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;">
                    Respond in the Chat &rarr;
                  </a>
                  <p style="margin:10px 0 0;font-size:12px;color:#aaa;">Opens the CATS community chat. Head to ${safeChannelName} to reply.</p>
                </div>
              </div>
            </div>
          `,
        }),
      });
      return res;
    };

    const results = [];

    // Mark's mentions. The (?<![\w.]) guard means the character right before "@" must
    // not be a typical email local-part character, so "jon@support.org" or
    // "sarah@markholdings.com" don't false-trigger. The \b at the end stops "@marketing"
    // from matching just "mark". Matches @mark, @dr.mayfield, @dr. mayfield,
    // @dr.mark.mayfield, @dr. mark mayfield, case-insensitively.
    if (/(?<![\w.])@(mark|dr\.?\s*(mark\s*)?mayfield)\b/i.test(text)) {
      const r = await sendEmail(
        'dr.mark.mayfield@gmail.com',
        `${senderName} mentioned you in ${channelName}`,
        'You were mentioned in the CATS Community',
        `You were mentioned in <strong>${safeChannelName}</strong>`
      );
      results.push('mark:' + r.status);
    }

    // Support / help requests. Same email-address guard as above.
    if (/(?<![\w.])@(support|help)\b/i.test(text)) {
      const r = await sendEmail(
        'jonathan@nexgenrva.com',
        `Support request from ${senderName} in ${channelName}`,
        'A support request came in from the CATS Community',
        `A support request came in from <strong>${safeChannelName}</strong>`
      );
      results.push('support:' + r.status);
    }

    return new Response('Processed ' + (results.join(', ') || 'no matches'), { status: 200 });
  }
};
