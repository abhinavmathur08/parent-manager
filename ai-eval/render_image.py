"""Renders an image fixture from its transcript (macOS only: uses qlmanage and sips).

    python3 ai-eval/render_image.py <fixture id>

Screenshots render plainly; photos get a paper colour, a serif font and a slight tilt. These
are stand-ins: real cookbook photos (of recipes we own) can replace them with the same file
name, as long as the transcript and gold still match.
"""
import html, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def render(path, text, photo):
    body = ''.join(
        f'<p style="margin:0 0 6px">{html.escape(l)}</p>' if l else '<p style="margin:0 0 14px"></p>'
        for l in text.split('\n'))
    bg, font = ('#f3ead8', 'Georgia,serif') if photo else ('#ffffff', '-apple-system,Helvetica,sans-serif')
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, 'page.html')
        with open(page, 'w') as f:
            f.write(f'<html><body style="background:{bg};color:#222;font:26px {font};margin:40px;width:820px">{body}</body></html>')
        subprocess.run(['qlmanage', '-t', '-s', '1000', '-o', tmp, page], capture_output=True, check=True)
        args = ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '60'] + (['-r', '3'] if photo else [])
        subprocess.run(args + [page + '.png', '--out', path], capture_output=True, check=True)


if __name__ == '__main__':
    fixtures = json.load(open(os.path.join(HERE, 'fixtures.json')))['recipes']
    fixture = next(f for f in fixtures if f['id'] == sys.argv[1])
    render(os.path.join(HERE, 'images', fixture['image']), fixture['transcript'], fixture['input'] == 'photo')
