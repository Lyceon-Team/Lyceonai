import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Camera, Upload, FileText, X, Send, Sparkles, 
  CheckCircle, AlertCircle, Loader2, ImageIcon 
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface UploadedFile {
  file: File;
  preview?: string;
  type: 'image' | 'pdf';
}

interface QuestionUploadProps {
  onQuestionSubmit?: (question: string, response: string) => void;
  className?: string;
}

export default function QuestionUpload({ onQuestionSubmit, className }: QuestionUploadProps) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [additionalContext, setAdditionalContext] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const isImage = validImageTypes.includes(file.type);
    const isPdf = file.type === 'application/pdf';

    if (!isImage && !isPdf) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image (JPG, PNG, WebP) or PDF file.",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 10MB.",
        variant: "destructive"
      });
      return;
    }

    const uploadedFile: UploadedFile = {
      file,
      type: isImage ? 'image' : 'pdf'
    };

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedFile.preview = e.target?.result as string;
        setUploadedFile(uploadedFile);
      };
      reader.readAsDataURL(file);
    } else {
      setUploadedFile(uploadedFile);
    }

    setError(null);
    setAiResponse(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
      handleFileSelect({ target: { files: dataTransfer.files } } as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const removeFile = () => {
    setUploadedFile(null);
    setAiResponse(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!uploadedFile) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 10, 85));
    }, 300);

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile.file);
      if (additionalContext.trim()) {
        formData.append('context', additionalContext.trim());
      }

      const response = await fetch('/api/student/analyze-question', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to analyze question');
      }

      const result = await response.json();
      
      setAiResponse(result.response);
      onQuestionSubmit?.(result.extractedQuestion || 'Uploaded question', result.response);

      toast({
        title: "Question analyzed!",
        description: "Here's what I found about your question.",
      });
    } catch (err) {
      clearInterval(progressInterval);
      const errorMessage = err instanceof Error ? err.message : 'Failed to process your question';
      setError(errorMessage);
      toast({
        title: "Analysis failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const resetAll = () => {
    setUploadedFile(null);
    setAdditionalContext('');
    setAiResponse(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="card-question-upload">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Camera className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Ask AI About My Question</CardTitle>
            <CardDescription>
              Upload a photo or PDF of your SAT question for instant help
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!uploadedFile && !aiResponse && (
          <div
            className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-question"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-muted">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Drop your question here</p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to take a photo / browse files
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <Badge variant="secondary" className="text-xs">
                  <ImageIcon className="h-3 w-3 mr-1" />
                  Images
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  PDF
                </Badge>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-file-question"
            />
          </div>
        )}

        {uploadedFile && !aiResponse && (
          <div className="space-y-4">
            <div className="relative rounded-lg border overflow-hidden bg-muted/30">
              {uploadedFile.type === 'image' && uploadedFile.preview ? (
                <div className="relative">
                  <img
                    src={uploadedFile.preview}
                    alt="Question preview"
                    className="w-full max-h-64 object-contain"
                    data-testid="img-question-preview"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={removeFile}
                    disabled={isProcessing}
                    data-testid="button-remove-file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950">
                      <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{uploadedFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={removeFile}
                    disabled={isProcessing}
                    data-testid="button-remove-pdf"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Additional context (optional)
              </label>
              <Textarea
                placeholder="E.g., 'I don't understand why the answer is B' or 'Can you explain the concept behind this?'"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                disabled={isProcessing}
                className="min-h-[80px] resize-none"
                data-testid="textarea-context"
              />
            </div>

            {isProcessing && (
              <div className="space-y-2" data-testid="processing-indicator">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Analyzing your question...</span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive" data-testid="error-message">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isProcessing}
              className="w-full"
              size="lg"
              data-testid="button-analyze-question"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Get AI Help
                </>
              )}
            </Button>
          </div>
        )}

        {aiResponse && (
          <div className="space-y-4" data-testid="ai-response-container">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">AI Analysis Complete</span>
            </div>
            
            <div className="rounded-lg bg-muted/50 border p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-full bg-primary flex-shrink-0">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-foreground">AI Tutor Response</p>
                  <div 
                    className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed"
                    data-testid="text-ai-response"
                  >
                    {aiResponse}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={resetAll}
                className="flex-1"
                data-testid="button-ask-another"
              >
                Ask Another Question
              </Button>
              <Button
                asChild
                className="flex-1"
                data-testid="button-continue-chat"
              >
                <a href="/chat">
                  <Send className="h-4 w-4 mr-2" />
                  Continue in Chat
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
