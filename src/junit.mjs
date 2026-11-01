// Internal formatter for a completed runProbes report. Select metadata only;
// do not serialize endpoint configuration or arbitrary report properties.
const attribute = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const seconds = milliseconds => (milliseconds / 1000).toFixed(6);

export function junitReport(report) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Probe Harbor" tests="${report.summary.checks}" failures="${report.summary.unhealthy}" errors="0" time="${seconds(report.summary.durationMs)}">`,
  ];
  for (const result of report.results) {
    const durationMs = result.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
    lines.push(`  <testcase classname="probe-harbor" name="${attribute(result.id)}" time="${seconds(durationMs)}">`);
    if (!result.healthy) lines.push(`    <failure type="${attribute(result.code)}" message="${attribute(result.code)}"/>`);
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  return lines.join('\n') + '\n';
}
