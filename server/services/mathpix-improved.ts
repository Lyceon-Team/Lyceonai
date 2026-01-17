/**
 * Improved Mathpix Service using 2024 PDF Streaming API
 * Based on latest Mathpix documentation and best practices
 */

interface MathpixPdfResponse {
  pdf_id: string;
  status: 'processing' | 'completed' | 'error';
  message?: string;
}

interface MathpixPdfStatus {
  status: 'processing' | 'completed' | 'error';
  percent_done: number;
  page_count?: number;
  error?: string;
}

interface MathpixPdfResult {
  text: string;
  confidence: number;
  pageCount: number;
  requestId: string;
  pages?: Array<{ pageNum: number; text: string }>; // Per-page text for region-specific extraction
}

interface MathpixStreamEvent {
  page_number?: number;
  text?: string;
  page_idx?: number;
  pdf_selected_len?: number;
  status?: 'completed' | 'processing' | 'error';
  error?: string;
}

export class ImprovedMathpixService {
  private readonly baseUrl = 'https://api.mathpix.com/v3';
  
  constructor() {}

  private getCredentials(): { appId: string; appKey: string } {
    // Try separate credentials first (preferred method)
    const appId = process.env.MATHPIX_API_ID;
    const appKey = process.env.MATHPIX_API_KEY_ONLY;
    
    if (appId && appKey) {
      return { appId: appId.trim(), appKey: appKey.trim() };
    }
    
    // Fallback to combined credential format
    const combinedKey = process.env.MATHPIX_APP_KEY || process.env.MATHPIX_API_KEY;
    if (combinedKey && combinedKey.includes(':')) {
      const [id, key] = combinedKey.split(':');
      if (id && key) {
        return { appId: id.trim(), appKey: key.trim() };
      }
    }
    
    throw new Error('Mathpix credentials required: Either set MATHPIX_API_ID + MATHPIX_API_KEY_ONLY or MATHPIX_APP_KEY in app_id:app_key format');
  }

  private createHeaders(): Record<string, string> {
    const { appId, appKey } = this.getCredentials();
    return {
      'app_id': appId,
      'app_key': appKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Upload PDF using the modern streaming API
   */
  async uploadPdfForStreaming(buffer: Buffer, filename: string = 'document.pdf'): Promise<string> {
    try {
      console.log(`📄 Uploading PDF to Mathpix streaming API: ${filename} (${buffer.length} bytes)`);
      
      // Method 1: Try file upload first (more reliable) - Node.js compatible
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
      formData.append('file', blob, filename);
      
      // Configure for PDF streaming with minimal, safe options
      const options = {
        streaming: true, // Enable streaming for faster results
        conversion_formats: {
          md: true   // Request markdown format output
        }
      };
      
      formData.append('options_json', JSON.stringify(options));
      
      const { appId, appKey } = this.getCredentials();
      const response = await fetch(`${this.baseUrl}/pdf`, {
        method: 'POST',
        headers: {
          'app_id': appId,
          'app_key': appKey
          // Don't set Content-Type for FormData - browser sets it automatically
        },
        body: formData
      });

      const responseText = await response.text();
      console.log(`📊 Upload response status: ${response.status}`);
      console.log(`📊 Upload response body: ${responseText}`);
      
      if (!response.ok) {
        console.error(`❌ Mathpix upload failed (${response.status}):`, responseText);
        throw new Error(`Mathpix PDF upload failed (${response.status}): ${responseText}`);
      }

      let result: MathpixPdfResponse;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Invalid JSON response from Mathpix: ${responseText}`);
      }
      
      console.log(`📊 Parsed result:`, result);
      
      if (!result.pdf_id) {
        throw new Error(`No PDF ID returned from Mathpix. Response: ${JSON.stringify(result)}`);
      }

      console.log(`✅ PDF uploaded successfully: ${result.pdf_id}`);
      return result.pdf_id;

    } catch (error: any) {
      console.error('❌ Mathpix PDF upload failed:', error.message);
      throw new Error(`Mathpix upload failed: ${error.message}`);
    }
  }

  /**
   * Stream PDF processing results in real-time
   */
  async streamPdfResults(pdfId: string): Promise<MathpixPdfResult> {
    try {
      console.log(`🔄 Starting Mathpix streaming for PDF: ${pdfId}`);
      
      const response = await fetch(`${this.baseUrl}/pdf/${pdfId}/stream`, {
        headers: {
          ...this.createHeaders(),
          'Accept': 'text/event-stream'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Streaming failed (${response.status}): ${errorText}`);
      }

      return new Promise((resolve, reject) => {
        const pages: Array<{ pageNum: number; text: string }> = [];
        let buffer = '';
        let totalPages = 0;
        
        // Set timeout for streaming
        const timeout = setTimeout(() => {
          reject(new Error('Mathpix streaming timeout after 15 minutes'));
        }, 15 * 60 * 1000); // 15 minutes

        if (!response.body) {
          clearTimeout(timeout);
          reject(new Error('No response body for streaming'));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) {
                clearTimeout(timeout);
                // Process final results
                this.finalizePdfResults(pages, pdfId, resolve, reject);
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              
              // Process complete SSE messages
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // Keep incomplete line in buffer
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const eventData = line.substring(6).trim();
                    
                    // Skip heartbeat and end markers
                    if (eventData === '' || eventData === '[DONE]') {
                      continue;
                    }
                    
                    const pageEvent: MathpixStreamEvent = JSON.parse(eventData);
                    
                    if (pageEvent.page_number && pageEvent.text) {
                      pages.push({
                        pageNum: pageEvent.page_number,
                        text: pageEvent.text
                      });
                      
                      console.log(`📄 Received page ${pageEvent.page_number} (${pageEvent.text.length} chars)`);
                      totalPages = Math.max(totalPages, pageEvent.page_number);
                    }
                    
                    if (pageEvent.status === 'completed') {
                      console.log(`🎉 Mathpix streaming completed - ${pages.length} pages received`);
                      clearTimeout(timeout);
                      this.finalizePdfResults(pages, pdfId, resolve, reject);
                      break;
                    }
                    
                    if (pageEvent.status === 'error') {
                      clearTimeout(timeout);
                      reject(new Error(`Mathpix processing error: ${pageEvent.error || 'Unknown error'}`));
                      break;
                    }
                    
                  } catch (parseError) {
                    // Log but don't fail on individual parse errors
                    console.warn('⚠️ Failed to parse SSE event:', line.substring(6));
                  }
                }
              }
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };

        processStream();
      });

    } catch (error: any) {
      console.error('❌ Mathpix streaming failed:', error.message);
      throw new Error(`Mathpix streaming failed: ${error.message}`);
    }
  }

  private finalizePdfResults(
    pages: Array<{ pageNum: number; text: string }>,
    pdfId: string,
    resolve: (result: MathpixPdfResult) => void,
    reject: (error: Error) => void
  ) {
    try {
      if (pages.length === 0) {
        reject(new Error('No pages received from Mathpix streaming'));
        return;
      }

      // Sort pages by page number and combine text
      pages.sort((a, b) => a.pageNum - b.pageNum);
      const combinedText = pages.map(page => page.text).join('\n\n');
      
      if (combinedText.length < 100) {
        reject(new Error('Insufficient text content received from Mathpix'));
        return;
      }

      console.log(`✅ Mathpix processing completed:`);
      console.log(`   📄 ${pages.length} pages processed`);
      console.log(`   📝 ${combinedText.length} total characters`);
      console.log(`   🔍 PDF ID: ${pdfId}`);

      resolve({
        text: this.cleanExtractedText(combinedText),
        confidence: 0.95, // Streaming API doesn't provide confidence, assume high
        pageCount: pages.length,
        requestId: pdfId,
        pages: pages // Include per-page data for region-specific extraction
      });

    } catch (error: any) {
      reject(new Error(`Failed to finalize results: ${error.message}`));
    }
  }

  /**
   * Fallback: Check PDF status using polling (if streaming fails)
   */
  async checkPdfStatus(pdfId: string): Promise<MathpixPdfStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/pdf/${pdfId}`, {
        headers: this.createHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status check failed (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(`Status check failed: ${error.message}`);
    }
  }

  /**
   * Fallback: Get final results using polling (if streaming fails)
   */
  async getPdfResults(pdfId: string): Promise<MathpixPdfResult> {
    try {
      // Wait for completion with polling fallback
      let attempts = 0;
      const maxAttempts = 60; // 10 minutes with 10-second intervals
      
      while (attempts < maxAttempts) {
        const status = await this.checkPdfStatus(pdfId);
        
        if (status.status === 'completed') {
          break;
        } else if (status.status === 'error') {
          throw new Error(`PDF processing failed: ${status.error}`);
        }
        
        console.log(`⏳ Processing... ${status.percent_done}% complete`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('PDF processing timeout');
      }

      // Get the results
      const response = await fetch(`${this.baseUrl}/pdf/${pdfId}.md`, {
        headers: this.createHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Results fetch failed (${response.status}): ${errorText}`);
      }

      const text = await response.text();
      
      return {
        text: this.cleanExtractedText(text),
        confidence: 0.9,
        pageCount: 1, // Unknown from this method
        requestId: pdfId
      };

    } catch (error: any) {
      throw new Error(`PDF results failed: ${error.message}`);
    }
  }

  /**
   * Main entry point: Extract text from PDF with streaming
   */
  async extractTextFromPDF(buffer: Buffer, filename: string = 'document.pdf'): Promise<MathpixPdfResult> {
    try {
      // Step 1: Upload PDF
      const pdfId = await this.uploadPdfForStreaming(buffer, filename);
      
      // Step 2: Try streaming first (best performance)
      try {
        return await this.streamPdfResults(pdfId);
      } catch (streamError: any) {
        console.warn(`⚠️ Streaming failed, falling back to polling: ${streamError.message}`);
        
        // Step 3: Fallback to polling method
        return await this.getPdfResults(pdfId);
      }

    } catch (error: any) {
      console.error('❌ Mathpix PDF extraction failed:', error.message);
      
      // Provide helpful error messages
      if (error.message.includes('401')) {
        throw new Error('Mathpix API authentication failed. Please check your API key.');
      } else if (error.message.includes('429')) {
        throw new Error('Mathpix API rate limit exceeded. Please try again later.');
      } else if (error.message.includes('413')) {
        throw new Error('PDF file too large for Mathpix processing. Maximum size is 1GB.');
      } else {
        throw new Error(`Mathpix extraction failed: ${error.message}`);
      }
    }
  }

  /**
   * Clean and normalize extracted text
   */
  private cleanExtractedText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u00A0\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\$\s{3,}\$/g, '')
      .replace(/\b(\d+)\.?\s*\)/g, '\n$1)')
      .replace(/\b([A-D])\.?\s*\)/g, '\n$1)')
      .trim();
  }

  /**
   * Test connection with the improved API using OCR usage endpoint
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test auth by checking account OCR usage (correct endpoint)
      const response = await fetch(`${this.baseUrl}/ocr-usage`, {
        headers: this.createHeaders()
      });

      if (response.status === 401) {
        return { success: false, message: 'Authentication failed - check API key format (app_id:app_key)' };
      } else if (response.status === 429) {
        return { success: false, message: 'Rate limit exceeded' };
      } else if (response.ok) {
        return { success: true, message: 'Mathpix PDF API connection successful' };
      } else if (response.status === 404) {
        return { success: false, message: 'Endpoint not found - possible authentication issue' };
      } else {
        return { success: false, message: `API returned status ${response.status}` };
      }
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error.message}` };
    }
  }
}

// Export instance for use in pipeline
export const improvedMathpixService = new ImprovedMathpixService();