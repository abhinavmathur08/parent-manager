// The sign-in email template is generated from the locale files (A-01.1, FR-AUTH-2).
const {
  escapeHtml,
  interpolate,
  readConfig,
  renderBody,
  renderTemplate,
} = require('../../scripts/email-templates.js');
const enUS = require('../../src/i18n/locales/en-US.json');

const copy = enUS.email.signInCode;

describe('email templates', () => {
  it('fills placeholders and refuses unknown ones', () => {
    expect(interpolate('Works for {{minutes}} minutes.', { minutes: 10 })).toBe(
      'Works for 10 minutes.',
    );
    expect(() => interpolate('Hi {{name}}', { minutes: 10 })).toThrow('No value for {{name}}');
  });

  it('escapes HTML in copy', () => {
    expect(escapeHtml(`<b>"Sam" & Alex's</b>`)).toBe(
      '&lt;b&gt;&quot;Sam&quot; &amp; Alex&#39;s&lt;/b&gt;',
    );
  });

  it('includes the code, the magic link and the lifetime', () => {
    const body = renderBody(copy, { minutes: 10 });
    expect(body).toContain('{{ .Token }}');
    expect(body).toContain('{{ .ConfirmationURL }}');
    expect(body).toContain('10 minutes');
  });

  it('fails when a string is missing', () => {
    expect(() => renderBody({ ...copy, heading: '' }, { minutes: 10 })).toThrow(
      'email.signInCode.heading',
    );
  });

  it('shares one body when the regional copy matches en-US', () => {
    const copies = { 'en-US': copy, 'en-GB': copy, 'en-AU': copy };
    const html = renderTemplate(copies, { minutes: 10 });
    expect(html).not.toContain('.Data.locale');
  });

  it('branches on the user locale when the copy differs', () => {
    const copies = {
      'en-US': copy,
      'en-GB': { ...copy, heading: 'Your sign-in code, mate' },
      'en-AU': copy,
    };
    const html = renderTemplate(copies, { minutes: 10 });
    expect(html).toContain('{{ if eq (printf "%v" .Data.locale) "en-GB" }}');
    expect(html).toContain('{{ else }}');
    expect(html).toContain('Your sign-in code, mate');
  });

  it('reads the code lifetime and subjects from config.toml', () => {
    const toml = [
      'otp_expiry = 600',
      '[auth.email.template.magic_link]',
      'subject = "Code"',
      'content_path = "./x.html"',
    ].join('\n');
    expect(readConfig(toml)).toEqual({
      minutes: 10,
      subjects: [{ type: 'magic_link', subject: 'Code' }],
    });
  });
});
