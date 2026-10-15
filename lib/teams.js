// Nachricht in einen Teams-Kanal über einen Workflow-Webhook (Teams: Kanal → Workflows →
// „Bei Empfang einer Webhookanforderung im Kanal posten“). Die erzeugte Adresse gehört nach TEAMS_WEBHOOK_URL.
export const teamsConfigured = () => /^https:\/\//.test(process.env.TEAMS_WEBHOOK_URL || '');

export async function postTeams({ title, text, url, linkText }) {
  if (!teamsConfigured()) return false;
  const body = [{ type: 'TextBlock', text: title, weight: 'Bolder', wrap: true }, { type: 'TextBlock', text, wrap: true }];
  const card = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body,
    actions: url ? [{ type: 'Action.OpenUrl', title: linkText || 'Im Terminplaner öffnen', url }] : [] };
  const r = await fetch(process.env.TEAMS_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] })
  });
  if (!r.ok) throw new Error('Teams meldet ' + r.status);
  return true;
}
