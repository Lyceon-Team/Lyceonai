// Quick test script to check existing PDFs directly
import { ObjectStorageService } from "./server/objectStorage.js";

async function testExistingPDFs() {
  try {
    console.log("Testing ObjectStorageService...");
    const objectStorage = new ObjectStorageService();
    
    console.log("Fetching existing PDFs...");
    const existingPDFs = await objectStorage.getExistingPDFs();
    
    console.log(`Found ${existingPDFs.length} existing PDFs:`);
    existingPDFs.forEach((pdf, index) => {
      console.log(`${index + 1}. ${pdf.fileName}`);
      console.log(`   Path: ${pdf.path}`);
      console.log(`   Size: ${pdf.size} bytes`);
      console.log(`   Uploaded: ${pdf.uploaded}`);
      console.log('');
    });
    
    return existingPDFs;
  } catch (error) {
    console.error("Error testing existing PDFs:", error);
    throw error;
  }
}

testExistingPDFs()
  .then(pdfs => {
    console.log("\n✅ Successfully retrieved existing PDFs");
    process.exit(0);
  })
  .catch(error => {
    console.error("\n❌ Failed to retrieve existing PDFs:", error);
    process.exit(1);
  });