import fs from 'node:fs';
import path from 'node:path';

export function writeMarkdownReport(name: string, body: string) {
  const outDir = path.resolve(process.cwd(), 'tests', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.md`);
  fs.writeFileSync(file, body, 'utf8');
  console.log('[REPORT] Wrote', file);
}

export interface TestResult {
  testName: string;
  status: 'PASS' | 'FAIL';
  error?: string;
  details?: any;
}

export interface ReportSection {
  section: string;
  tests: TestResult[];
}

export class TestReporter {
  private results: ReportSection[] = [];

  addSection(section: string) {
    this.results.push({ section, tests: [] });
  }

  addTest(testName: string, status: 'PASS' | 'FAIL', error?: string, details?: any) {
    const currentSection = this.results[this.results.length - 1];
    if (currentSection) {
      currentSection.tests.push({ testName, status, error, details });
    }
  }

  generateMarkdownReport(): string {
    const timestamp = new Date().toISOString();
    let report = `# NextAuth.js + Schema + Practice Flow Test Report\n\n`;
    report += `**Generated:** ${timestamp}\n\n`;

    let totalTests = 0;
    let passedTests = 0;

    for (const section of this.results) {
      report += `## ${section.section}\n\n`;
      
      for (const test of section.tests) {
        totalTests++;
        if (test.status === 'PASS') passedTests++;
        
        const status = test.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
        report += `- **${test.testName}**: ${status}\n`;
        
        if (test.error) {
          report += `  - Error: ${test.error}\n`;
        }
        
        if (test.details) {
          report += `  - Details: ${JSON.stringify(test.details, null, 2)}\n`;
        }
      }
      
      report += '\n';
    }

    report += `## Summary\n\n`;
    report += `- **Total Tests:** ${totalTests}\n`;
    report += `- **Passed:** ${passedTests}\n`;
    report += `- **Failed:** ${totalTests - passedTests}\n`;
    report += `- **Success Rate:** ${totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0}%\n\n`;

    return report;
  }

  async saveReport(filename: string = 'auth_schema_practice_report.md') {
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const report = this.generateMarkdownReport();
    const filepath = path.join(reportsDir, filename);
    
    fs.writeFileSync(filepath, report);
    console.log(`📊 Test report saved to: ${filepath}`);
    
    return filepath;
  }
}