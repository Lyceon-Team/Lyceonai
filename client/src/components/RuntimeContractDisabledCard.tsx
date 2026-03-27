import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRuntimeContractDisabledCopy, type RuntimeContractDomain } from "@/lib/runtime-contract-disable";

export default function RuntimeContractDisabledCard(props: {
  domain: RuntimeContractDomain;
  code?: string | null;
  className?: string;
}) {
  const copy = getRuntimeContractDisabledCopy(props.domain);

  return (
    <Card className={props.className}>
      <CardHeader>
        <AlertCircle className="h-10 w-10 text-orange-500 mb-2" />
        <CardTitle>{copy.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{copy.description}</p>
        {props.code ? (
          <p className="text-xs text-muted-foreground">Code: {props.code}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
