// Reads the newest sign-in code sent to EMAIL from the local stack's Mailpit inbox.
var MAILPIT = 'http://127.0.0.1:54324';
var search = http.get(MAILPIT + '/api/v1/search?query=' + encodeURIComponent('to:"' + EMAIL + '"'));
var messages = json(search.body).messages;
if (!messages || messages.length === 0) {
  throw new Error('No email for ' + EMAIL + ' in Mailpit');
}
var message = json(http.get(MAILPIT + '/api/v1/message/' + messages[0].ID).body);
var text = (message.Text || '') + ' ' + (message.HTML || '').replace(/<[^>]*>/g, ' ');
var match = text.match(/\b(\d{6})\b/);
if (!match) {
  throw new Error('No 6-digit code in the email to ' + EMAIL);
}
output.code = match[1];
