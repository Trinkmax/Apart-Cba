"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Save, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { saveCrmWorkflowGraph, publishCrmWorkflow, setCrmWorkflowStatus } from "@/lib/actions/crm-workflows";
import { CrmNodeView } from "./nodes/crm-node-view";
import { NodePaletteModal } from "./node-palette-modal";
import { NodeSettingsDrawer } from "./node-settings-drawer";
import type {
  CrmWhatsAppTemplate,
  CrmTag,
  CrmChannel,
  CrmWorkflow,
  CrmWorkflowGraph,
  CrmWorkflowNode,
} from "@/lib/types/database";

interface Props {
  workflow: CrmWorkflow;
  tags: CrmTag[];
  channels: CrmChannel[];
  templates: CrmWhatsAppTemplate[];
  aiEnabledModels: string[];
  canEdit: boolean;
}

export function WorkflowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ workflow, tags, templates, aiEnabledModels, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteFromNodeId, setPaletteFromNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initial state desde el workflow.graph
  const initialGraph = workflow.graph as CrmWorkflowGraph;
  const [nodes, setNodes] = useState<Node[]>(() =>
    initialGraph.nodes.map((n) => ({
      id: n.id,
      type: "crm",
      position: n.position,
      data: { ...n.data, nodeType: n.type },
    })),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    initialGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: e.label,
      type: "smoothstep",
      animated: workflow.status === "active",
    })),
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    setDirty(true);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds));
    setDirty(true);
  }, []);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDelete = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setDirty(true);
  }, [selectedNodeId]);

  const handleAddNode = useCallback((nodeType: string, defaultConfig: Record<string, unknown>) => {
    const newId = `n-${Date.now()}`;
    let position = { x: 400, y: 100 + nodes.length * 120 };
    const connectFrom = paletteFromNodeId;

    if (connectFrom) {
      const fromNode = nodes.find((n) => n.id === connectFrom);
      if (fromNode) position = { x: fromNode.position.x, y: fromNode.position.y + 140 };
    }

    setNodes((nds) => [
      ...nds,
      {
        id: newId,
        type: "crm",
        position,
        data: { config: defaultConfig, nodeType },
      },
    ]);

    if (connectFrom) {
      setEdges((eds) => [
        ...eds,
        { id: `e-${connectFrom}-${newId}`, source: connectFrom, target: newId, type: "smoothstep" },
      ]);
    }

    setPaletteOpen(false);
    setPaletteFromNodeId(null);
    setSelectedNodeId(newId);
    setDirty(true);
  }, [nodes, paletteFromNodeId]);

  const handleUpdateNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config } } : n));
    setDirty(true);
  }, []);

  const buildGraph = useCallback((): CrmWorkflowGraph => ({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as { nodeType: string }).nodeType,
      position: n.position,
      data: { config: (n.data as { config?: Record<string, unknown> }).config ?? {} },
    })) as CrmWorkflowNode[],
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: typeof e.label === "string" ? e.label : undefined,
    })),
  }), [nodes, edges]);

  const handleSave = useCallback(() => {
    startTransition(async () => {
      try {
        const r = await saveCrmWorkflowGraph({
          id: workflow.id,
          graph: buildGraph(),
        });
        if (r.errors.length > 0) {
          toast.warning(`Guardado con ${r.errors.length} advertencia(s) de validación`);
        } else {
          toast.success("Guardado");
        }
        setDirty(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }, [workflow.id, buildGraph]);

  const handlePublish = useCallback(() => {
    startTransition(async () => {
      try {
        await saveCrmWorkflowGraph({ id: workflow.id, graph: buildGraph() });
        await publishCrmWorkflow(workflow.id);
        toast.success("Workflow publicado");
        setDirty(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al publicar");
      }
    });
  }, [workflow.id, buildGraph, router]);

  const handleStatusToggle = (on: boolean) => {
    startTransition(async () => {
      await setCrmWorkflowStatus(workflow.id, on ? "active" : "inactive");
      router.refresh();
    });
  };

  // Wire onAddAfter / onDelete a los nodos via context
  const nodeTypes = useMemo(() => ({
    crm: (p: NodeProps) => (
      <CrmNodeView
        {...p}
        onAddAfter={(id: string) => {
          setPaletteFromNodeId(id);
          setPaletteOpen(true);
        }}
        onDelete={onNodeDelete}
      />
    ),
  }), [onNodeDelete]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-zinc-950">
      {/* Toolbar */}
      <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0 text-zinc-400 hover:text-white">
            <Link href="/dashboard/crm/workflows">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="font-semibold truncate text-zinc-100">{workflow.name}</h1>
          {workflow.status === "draft" && (
            <span className="text-[10px] uppercase font-semibold tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
              Borrador
            </span>
          )}
          {dirty && (
            <span className="text-xs text-amber-400 inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> Cambios sin guardar
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <div className="flex items-center gap-2 mr-2">
                <span className="text-xs text-zinc-400">Activo</span>
                <Switch
                  checked={workflow.status === "active"}
                  onCheckedChange={handleStatusToggle}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleSave} disabled={isPending} className="border-zinc-700 hover:bg-zinc-800">
                <Save className="size-3.5 mr-1.5" /> Guardar
              </Button>
              <Button size="sm" onClick={handlePublish} disabled={isPending} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                Publicar
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.3}
          maxZoom={2}
          defaultEdgeOptions={{ type: "smoothstep", style: { stroke: "#52525b", strokeWidth: 2 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
          <Controls className="!bg-zinc-900 !border-zinc-800" />
          <MiniMap
            className="!bg-zinc-900 !border-zinc-800"
            nodeColor={() => "#10b981"}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {/* FAB Agregar paso */}
        {canEdit && (
          <button
            onClick={() => { setPaletteFromNodeId(null); setPaletteOpen(true); }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-semibold shadow-xl flex items-center gap-2 z-10"
          >
            <Plus className="size-5" /> Agregar paso
          </button>
        )}
      </div>

      {/* Settings drawer */}
      {selectedNode && canEdit && (
        <NodeSettingsDrawer
          key={selectedNode.id}
          node={selectedNode}
          tags={tags}
          templates={templates}
          aiEnabledModels={aiEnabledModels}
          onClose={() => setSelectedNodeId(null)}
          onChange={(config) => handleUpdateNodeConfig(selectedNode.id, config)}
          onDelete={() => {
            onNodeDelete(selectedNode.id);
            setSelectedNodeId(null);
          }}
        />
      )}

      {/* Palette modal */}
      {paletteOpen && (
        <NodePaletteModal
          onClose={() => { setPaletteOpen(false); setPaletteFromNodeId(null); }}
          onSelect={handleAddNode}
        />
      )}
    </div>
  );
}
