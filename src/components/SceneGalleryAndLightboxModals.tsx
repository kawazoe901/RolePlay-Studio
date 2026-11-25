import React from 'react';
import { ChatMessage, ChatSession, GeneratedMedia } from '../types';
import {
  Download,
  FolderOpen,
  Image as ImageIcon,
  RotateCcw,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';

interface Props {
  activeSession: ChatSession | undefined;
  showGalleryModal: boolean;
  onCloseGallery: () => void;
  lightboxImage: GeneratedMedia | null;
  onSetLightboxImage: (img: GeneratedMedia | null) => void;
  generatingImageForMsgId: string | null;
  onRegenerateMessageImage: (msg: ChatMessage, img: GeneratedMedia) => void;
  onOpenPromptPreview: (msg: ChatMessage, img: GeneratedMedia) => void;
  onDownloadImage: (img: GeneratedMedia) => void;
  onDeleteMessageImage: (msgId: string, img: GeneratedMedia) => void;
}

export const SceneGalleryAndLightboxModals: React.FC<Props> = ({
  activeSession,
  showGalleryModal,
  onCloseGallery,
  lightboxImage,
  onSetLightboxImage,
  generatingImageForMsgId,
  onRegenerateMessageImage,
  onOpenPromptPreview,
  onDownloadImage,
  onDeleteMessageImage,
}) => {
  return (
    <>
      {/* Modal: Per-Chat Scene Image Gallery (REQ-006) */}
      {showGalleryModal && activeSession && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <ImageIcon className="w-4 h-4 text-fuchsia-400" />
                  Scene Gallery — {activeSession.title}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <FolderOpen className="w-3 h-3 text-fuchsia-400" />
                  Storage Folder:{' '}
                  <code className="text-slate-300">data/images/</code>
                </p>
              </div>
              <button
                onClick={onCloseGallery}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeSession.messages.flatMap((m) => m.images || []).length ===
              0 ? (
                <p className="text-xs text-slate-400 text-center py-12">
                  No scene illustrations generated in this story yet. Click
                  "Visualize Scene" on any message to render via ComfyUI!
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {activeSession.messages
                    .flatMap((m) =>
                      (m.images || []).map((img) => ({ msg: m, img }))
                    )
                    .map(({ msg, img }) => (
                      <div
                        key={img.id}
                        onClick={() => {
                          onCloseGallery();
                          onSetLightboxImage(img);
                        }}
                        className="group relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 cursor-pointer hover:border-fuchsia-500/50 transition"
                      >
                        <img
                          src={img.imageUrl}
                          alt={img.prompt}
                          className="w-full h-48 object-cover"
                        />
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-lg p-1 shadow-lg"
                        >
                          <button
                            onClick={() => {
                              onCloseGallery();
                              onRegenerateMessageImage(msg, img);
                            }}
                            disabled={Boolean(generatingImageForMsgId)}
                            title="Regenerate this image"
                            className="p-1.5 rounded hover:bg-fuchsia-600/30 text-fuchsia-300 hover:text-white transition disabled:opacity-40"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDownloadImage(img)}
                            title="Download PNG"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteMessageImage(msg.id, img)}
                            title="Delete this image"
                            className="p-1.5 rounded hover:bg-rose-600/30 text-rose-400 hover:text-rose-200 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="p-2.5 space-y-1">
                          <div className="text-[11px] font-medium text-fuchsia-400">
                            {img.workflowName}
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2">
                            {img.prompt}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Generated Images */}
      {lightboxImage && (
        <div
          onClick={() => onSetLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full overflow-hidden max-h-[92vh] overflow-y-auto"
          >
            <div className="relative bg-black">
              <img
                src={lightboxImage.imageUrl}
                alt={lightboxImage.prompt}
                className="max-h-[68vh] w-auto mx-auto object-contain"
              />
              <button
                onClick={() => onSetLightboxImage(null)}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-fuchsia-400">
                    Workflow: {lightboxImage.workflowName}
                  </span>
                  <span>Seed: {lightboxImage.seed}</span>
                </div>
                {(() => {
                  const ownerMsg = activeSession?.messages.find((m) =>
                    (m.images || []).some((im) => im.id === lightboxImage.id)
                  );
                  return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ownerMsg && (
                        <>
                          <button
                            onClick={() => {
                              const targetImg = lightboxImage;
                              onSetLightboxImage(null);
                              onRegenerateMessageImage(ownerMsg, targetImg);
                            }}
                            disabled={Boolean(generatingImageForMsgId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-600/20 hover:bg-fuchsia-600/35 text-fuchsia-200 border border-fuchsia-500/30 font-medium transition disabled:opacity-40"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Regenerate
                          </button>
                          <button
                            onClick={() => {
                              const targetImg = lightboxImage;
                              onSetLightboxImage(null);
                              onOpenPromptPreview(ownerMsg, targetImg);
                            }}
                            disabled={Boolean(generatingImageForMsgId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 border border-indigo-500/30 font-medium transition disabled:opacity-40"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            Edit Prompt
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => onDownloadImage(lightboxImage)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                      {ownerMsg && (
                        <button
                          onClick={() =>
                            onDeleteMessageImage(ownerMsg.id, lightboxImage)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-500/30 font-medium transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
              <p className="text-slate-200 leading-relaxed">
                {lightboxImage.prompt}
              </p>
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                  PC Storage:{' '}
                  <code className="text-slate-300">
                    {lightboxImage.localPath ||
                      (lightboxImage.imageUrl.startsWith('/api/images/')
                        ? `data/images/${lightboxImage.imageUrl.replace(
                            '/api/images/',
                            ''
                          )}`
                        : 'Stored in data/roleplay-db.json (new renders save to data/images/)')}
                  </code>
                </span>
                {lightboxImage.comfyFilename && (
                  <span>
                    ComfyUI Output:{' '}
                    <code className="text-slate-300">
                      {lightboxImage.comfyFilename}
                    </code>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
