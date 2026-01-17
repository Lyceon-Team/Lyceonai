import * as React from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn("min-h-screen bg-background text-foreground", className)}>
      {children}
    </div>
  );
}

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "narrow" | "wide" | "full";
}

export function Container({ children, className, size = "default" }: ContainerProps) {
  const maxWidthClass = {
    narrow: "max-w-3xl",
    default: "max-w-4xl",
    wide: "max-w-6xl",
    full: "max-w-7xl",
  }[size];

  return (
    <div className={cn(maxWidthClass, "mx-auto px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  id?: string;
}

export function Section({ children, className, title, subtitle, id }: SectionProps) {
  return (
    <section id={id} className={cn("py-12", className)}>
      {(title || subtitle) && (
        <div className="mb-8">
          {title && (
            <h2 className="text-2xl font-semibold mb-2">{title}</h2>
          )}
          {subtitle && (
            <p className="text-muted-foreground">{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

interface ProseProps {
  children: React.ReactNode;
  className?: string;
}

export function Prose({ children, className }: ProseProps) {
  return (
    <div className={cn(
      "prose-lyceon",
      "max-w-none",
      "[&>p]:mb-4 [&>p]:leading-relaxed",
      "[&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:mt-10 [&>h2]:mb-4",
      "[&>h3]:text-xl [&>h3]:font-semibold [&>h3]:mt-8 [&>h3]:mb-3",
      "[&>ul]:list-disc [&>ul]:ml-6 [&>ul]:mb-4 [&>ul]:space-y-2",
      "[&>ol]:list-decimal [&>ol]:ml-6 [&>ol]:mb-4 [&>ol]:space-y-2",
      "[&>blockquote]:border-l-4 [&>blockquote]:border-border [&>blockquote]:pl-4 [&>blockquote]:italic [&>blockquote]:text-muted-foreground",
      "[&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80",
      "[&_strong]:font-semibold",
      className
    )}>
      {children}
    </div>
  );
}

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav className={cn("text-sm text-muted-foreground mb-8", className)}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="mx-2">/</span>}
          {item.href ? (
            <a href={item.href} className="hover:text-foreground transition-colors">
              {item.label}
            </a>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: "div" | "article";
}

export function Card({ children, className, hover = false, as: Component = "div" }: CardProps) {
  return (
    <Component className={cn(
      "p-6 bg-card border border-border rounded-2xl",
      hover && "hover:border-foreground/30 transition-colors",
      className
    )}>
      {children}
    </Component>
  );
}

interface HeroProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function Hero({ title, subtitle, children, className }: HeroProps) {
  return (
    <div className={cn("pt-16 pb-8", className)}>
      <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-3xl">
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}
