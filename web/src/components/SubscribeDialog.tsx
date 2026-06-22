import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const FEEDS = [
  { label: "RSS feed", url: "https://status.honch.io/feed.rss" },
  { label: "Atom feed", url: "https://status.honch.io/feed.atom" },
];

function FeedRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked — no-op */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-sm">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/60 py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-foreground text-xs">{url}</code>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`Copy ${label} URL`}
          onClick={copy}
          className={copied ? "text-success-foreground" : undefined}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

export function SubscribeDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Subscribe to updates
          </Button>
        }
      />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Subscribe to updates</DialogTitle>
          <DialogDescription>
            Follow incidents and status changes in your feed reader.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6">
          {FEEDS.map((f) => (
            <FeedRow key={f.url} {...f} />
          ))}
        </div>
        <DialogFooter variant="bare" className="flex-col">
          <Separator className="mb-2" />
          <Button
            variant="outline"
            className="w-full"
            render={
              <a
                href="https://github.com/honch-io/upptime/issues"
                target="_blank"
                rel="noopener"
              >
                View incident history on GitHub
              </a>
            }
          />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
