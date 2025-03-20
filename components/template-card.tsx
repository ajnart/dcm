import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DockerTool } from "@/lib/docker-tools";
import type { Template } from "@/lib/templates";
import { getToolsFromTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { CheckCircle, Package, PlusCircle } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";

interface TemplateCardProps {
  template: Template;
  allTools: DockerTool[];
  onSelectTemplate: (tools: DockerTool[]) => void;
  isSelected?: boolean;
}

export function TemplateCard({ template, allTools, onSelectTemplate, isSelected = false }: TemplateCardProps) {
  const [loading, setLoading] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const handleSelectTemplate = () => {
    if (isSelected) return;
    
    setLoading(true);
    try {
      const templateTools = getToolsFromTemplate(template, allTools);
      if (templateTools.length === 0) {
        toast.error("No valid tools found in this template");
        return;
      }
      
      onSelectTemplate(templateTools);
      toast.success(`Added ${templateTools.length} tools from "${template.name}" template`);
    } catch (error) {
      toast.error("Failed to add template tools");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Find tools in this template to display count
  const templateTools = getToolsFromTemplate(template, allTools);
  const unavailableTools = template.tools.length - templateTools.length;

  // Select up to 4 tools to display as preview
  const previewTools = templateTools.slice(0, 4);

  return (
    <Card 
      className={cn(
        "group relative flex h-full w-full flex-col cursor-pointer select-none overflow-hidden transition-all duration-300",
        isSelected 
          ? "bg-secondary border-primary" 
          : "hover:border-muted-foreground/20 border-border",
        "hover:motion-safe:scale-[1.03] hover:shadow-md"
      )}
      onClick={handleSelectTemplate}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div 
        className={cn(
          "h-1 w-full transition-colors duration-300",
          isSelected 
            ? "bg-primary" 
            : isHovering 
              ? "bg-primary/30" 
              : "bg-transparent"
        )}
      />
      
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {template.icon ? (
              <div className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md transition-all duration-300",
                isSelected 
                  ? "bg-primary/40 text-primary-foreground" 
                  : "bg-primary/10 text-primary group-hover:bg-primary/20"
              )}>
                <Image 
                  src={template.icon}
                  alt={template.name}
                  width={40}
                  height={40}
                  className="object-contain p-1.5"
                />
              </div>
            ) : (
              <div className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md transition-all duration-300",
                isSelected 
                  ? "bg-primary/40 text-primary-foreground" 
                  : "bg-primary/10 text-primary group-hover:bg-primary/20"
              )}>
                <Package size={20} />
              </div>
            )}
            <div>
              <CardTitle className="text-lg leading-tight">{template.name}</CardTitle>
              <div className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground inline-block mt-1">
                {template.category}
              </div>
            </div>
          </div>
        </div>
        <CardDescription className="h-10 line-clamp-2 mt-2">
          {template.description}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 space-y-3 pb-4">
        <div className="text-sm flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {templateTools.length} tools included
          </Badge>
          {unavailableTools > 0 && (
            <span className="text-xs text-muted-foreground">
              ({unavailableTools} unavailable)
            </span>
          )}
        </div>
        
        {/* Preview of the included tools */}
        <div className="flex flex-wrap gap-1.5">
          {previewTools.map((tool) => (
            <Badge 
              key={tool.id}
              variant="outline" 
              className={cn(
                "rounded-md px-1.5 py-0.5 text-xs font-normal transition-all duration-300",
                isSelected ? "bg-secondary/80" : "group-hover:bg-background/80"
              )}
            >
              {tool.icon && (
                <Image 
                  src={tool.icon} 
                  alt={tool.name} 
                  width={12} 
                  height={12} 
                  className="mr-1.5 object-contain"
                />
              )}
              {tool.name}
            </Badge>
          ))}
          {templateTools.length > 4 && (
            <Badge 
              variant="outline" 
              className="rounded-md bg-muted/80 px-1.5 py-0.5 text-xs font-normal"
            >
              +{templateTools.length - 4} more
            </Badge>
          )}
        </div>
      </CardContent>
      
      <div 
        className={cn(
          "mt-auto flex items-center justify-center p-3 border-t transition-colors duration-200",
          isSelected 
            ? "bg-secondary/70 border-primary/30" 
            : "bg-muted/20 border-muted group-hover:bg-muted/40"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Button 
          variant={isSelected ? "outline" : "default"} 
          className={cn(
            "w-full transition-all gap-2 font-medium",
            !loading && !isSelected && "motion-safe:hover:scale-105"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (!isSelected) handleSelectTemplate();
          }}
          disabled={loading || templateTools.length === 0 || isSelected}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Adding...
            </span>
          ) : isSelected ? (
            <>
              <CheckCircle size={16} className="text-green-500" />
              Template Selected
            </>
          ) : (
            <>
              <PlusCircle size={16} />
              Use Template
            </>
          )}
        </Button>
      </div>
    </Card>
  );
} 