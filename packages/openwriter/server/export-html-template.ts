/**
 * HTML template for document export.
 * Returns a complete HTML document with embedded print-friendly CSS.
 * Used by both .html export and PDF print preview.
 */

export function buildExportHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 16px;
      line-height: 1.7;
      color: #1a1a1a;
      max-width: 700px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    h1, h2, h3, h4, h5, h6 {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      line-height: 1.3;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      color: #111;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }

    p { margin-bottom: 1em; }

    a { color: #2563eb; text-decoration: underline; }

    blockquote {
      border-left: 3px solid #ccc;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #555;
    }

    pre {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px 16px;
      overflow-x: auto;
      margin: 1em 0;
      font-size: 14px;
      line-height: 1.5;
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.9em;
      background: #f0f0f0;
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre code { background: none; padding: 0; border-radius: 0; }

    ul, ol { margin: 1em 0; padding-left: 2em; }
    li { margin-bottom: 0.3em; }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px 12px;
      text-align: left;
    }
    th { background: #f5f5f5; font-weight: 600; }

    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }

    img { max-width: 100%; height: auto; }

    ins { text-decoration: underline; }
    mark { background: #fff3a3; padding: 1px 2px; }
    sub { font-size: 0.75em; }
    sup { font-size: 0.75em; }

    @media print {
      body { padding: 0; max-width: none; }
      a { color: inherit; text-decoration: none; }
      pre { border-color: #ccc; }
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
