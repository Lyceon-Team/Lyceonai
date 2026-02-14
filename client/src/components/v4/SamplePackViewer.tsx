import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Eye, Loader, Image as ImageIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SamplePage {
  id: string;
  pdf_path: string;
  page_number: number;
  image_path: string;
  domain: string | null;
  difficulty: string | null;
}

interface SamplePackViewerProps {
  clusterId: string;
  clusterKey: string;
}

export function SamplePackViewer({ clusterId, clusterKey }: SamplePackViewerProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ samples: SamplePage[] }>({
    queryKey: ['/api/ingestion-v4/clusters', clusterId, 'sample-pack'],
    queryFn: async () => {
      const res = await fetch(`/api/ingestion-v4/clusters/sample-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId, packSize: 8 })
      });
      if (!res.ok) throw new Error('Failed to load sample pack');
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Eye className="w-3 h-3 mr-1" />
          Sample Pack
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Sample Pack: {clusterKey}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 p-4">
              {data?.samples?.map((sample, idx) => (
                <div key={sample.id} className="space-y-2 border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Sample {idx + 1}</span>
                    <div className="flex gap-1">
                      {sample.domain && <Badge variant="outline">{sample.domain}</Badge>}
                      {sample.difficulty && <Badge variant="secondary">{sample.difficulty}</Badge>}
                    </div>
                  </div>
                  <div className="aspect-[8.5/11] bg-gray-100 dark:bg-gray-800 rounded overflow-hidden relative">
                    <img
                      src={`/api/ingestion-v4/style-bank/pages/${sample.id}/image`}
                      alt={`Page ${sample.page_number}`}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    <ImageIcon className="w-3 h-3 inline mr-1" />
                    {sample.pdf_path.split('/').pop()} - p.{sample.page_number}
                  </div>
                </div>
              )) || (
                <div className="col-span-2 text-center py-8 text-muted-foreground">
                  No samples available for this cluster
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
