import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div>
      <div>
        <div className="flex mb-4 gap-2">
          <AlertCircle className="h-8 w-8 text-amber-600" />
          <h1 className="text-2xl font-bold text-gray-900">
            404 Page Not Found
          </h1>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          Did you forget to add the page to the router?
        </p>
      </div>
    </div>
  );
}
