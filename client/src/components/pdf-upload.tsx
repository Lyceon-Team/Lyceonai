import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CloudUpload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UploadStatus {
  isUploading: boolean;
  progress: number;
  filename?: string;
  documentId?: string;
}

export default function PDFUpload() {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    progress: 0
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast({
        title: "Invalid file type",
        description: "Please select a PDF file.",
        variant: "destructive"
      });
      return;
    }

    setUploadStatus({
      isUploading: true,
      progress: 0,
      filename: file.name
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadStatus(prev => ({
          ...prev,
          progress: Math.min(prev.progress + 10, 90)
        }));
      }, 200);

      // Get admin token from environment or use dev default
      const adminToken = import.meta.env.VITE_INGEST_ADMIN_TOKEN || 'changeme';

      const response = await apiRequest('/api/ingest/pdf', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        },
        body: formData
      });
      const result = await response.json();

      clearInterval(progressInterval);

      if (result.jobId) {
        setUploadStatus({
          isUploading: false,
          progress: 100,
          filename: file.name,
          documentId: result.jobId
        });

        toast({
          title: "Upload successful",
          description: "Your PDF is being processed. Questions will appear shortly.",
        });

        // Start polling for processing status
        pollProcessingStatus(result.jobId);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus({
        isUploading: false,
        progress: 0
      });
      
      toast({
        title: "Upload failed",
        description: "There was an error uploading your file. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const pollProcessingStatus = async (jobId: string) => {
    const checkStatus = async () => {
      try {
        const adminToken = import.meta.env.VITE_INGEST_ADMIN_TOKEN || 'changeme';
        const response = await apiRequest(`/api/ingest-llm/status/${jobId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        });
        const statusData = await response.json();
        
        if (statusData.status === 'DONE') {
          toast({
            title: "Processing complete",
            description: `Successfully processed ${statusData.questionsImported || 0} questions from your PDF.`,
          });
          
          // Reset to initial state
          setTimeout(() => {
            setUploadStatus({
              isUploading: false,
              progress: 0
            });
          }, 2000);
          
          return true; // Stop polling
        } else if (statusData.status === 'FAILED') {
          toast({
            title: "Processing failed", 
            description: statusData.error || "There was an issue processing your PDF. Please try uploading a different file.",
            variant: "destructive"
          });
          
          // Reset to initial state  
          setUploadStatus({
            isUploading: false,
            progress: 0
          });
          
          return true; // Stop polling
        }
        
        return false; // Continue polling
      } catch (error) {
        console.error('Status check error:', error);
        return false; // Continue polling
      }
    };

    // Poll every 2 seconds for up to 30 seconds
    let attempts = 0;
    const maxAttempts = 15;
    
    const pollInterval = setInterval(async () => {
      attempts++;
      const shouldStop = await checkStatus();
      
      if (shouldStop || attempts >= maxAttempts) {
        clearInterval(pollInterval);
        
        if (attempts >= maxAttempts) {
          toast({
            title: "Processing timeout",
            description: "PDF processing is taking longer than expected. Please check back later.",
            variant: "destructive"
          });
          
          setUploadStatus({
            isUploading: false,
            progress: 0
          });
        }
      }
    }, 2000);
  };

  return (
    <Card data-testid="card-pdf-upload">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">
            Upload SAT Practice Test
          </h3>
          <span className="text-xs text-muted-foreground">PDF files only</span>
        </div>
        
        {!uploadStatus.isUploading && uploadStatus.progress === 0 ? (
          <>
            <div 
              className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={handleBrowseClick}
              data-testid="dropzone-upload"
            >
              <CloudUpload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-foreground font-medium mb-2">
                Drop your SAT practice test here
              </p>
              <p className="text-muted-foreground text-sm mb-4">
                or click to browse files
              </p>
              <Button 
                type="button"
                data-testid="button-select-file"
              >
                Select File
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileInputChange}
              className="hidden"
              data-testid="input-file-hidden"
            />
          </>
        ) : (
          <div className="mt-4" data-testid="upload-progress-container">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-foreground" data-testid="text-processing-filename">
                Processing: {uploadStatus.filename}
              </span>
              <span className="text-muted-foreground" data-testid="text-progress-percentage">
                {uploadStatus.progress}%
              </span>
            </div>
            <Progress 
              value={uploadStatus.progress} 
              className="w-full"
              data-testid="progress-upload"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Extracting questions and creating embeddings...
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
