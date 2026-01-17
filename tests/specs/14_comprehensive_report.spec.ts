import { test } from '@playwright/test';
import { TestReporter } from '../utils/report';

test.describe('Comprehensive Test Report Generation', () => {
  test('should generate final comprehensive test report', async () => {
    const reporter = new TestReporter();
    
    // This test runs last and consolidates all test results
    reporter.addSection('Final Report Summary');
    
    try {
      // Generate and save the comprehensive report
      await reporter.saveReport('auth_schema_practice_report.md');
      
      reporter.addTest(
        'Final Test Report Generation',
        'PASS',
        undefined,
        { reportGenerated: true, timestamp: new Date().toISOString() }
      );
      
      console.log('🎯 Comprehensive test suite completed!');
      console.log('📊 Final report generated: tests/reports/auth_schema_practice_report.md');
      
    } catch (error) {
      reporter.addTest(
        'Final Test Report Generation',
        'FAIL',
        `Report generation failed: ${error}`
      );
    }
  });
});