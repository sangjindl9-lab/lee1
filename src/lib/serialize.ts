import type { MediaAsset, Tag } from "@prisma/client";
import { ageLabelAt, ageMonthsAt, formatKstDateTime } from "./date";
import { VISIBILITY_LABEL } from "./constants";

export type MediaWithRelations = MediaAsset & {
  tags?: Array<{ tag: Tag }>;
  child?: { id: string; name: string; nickname: string; birthDate: Date } | null;
  _count?: { likes?: number; comments?: number };
};

export type MediaDTO = {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  childId: string;
  childName: string | null;
  childNickname: string | null;
  albumId: string;
  capturedAt: string;
  capturedAtLabel: string;
  ageMonths: number;
  ageLabel: string;
  visibility: string;
  visibilityLabel: string;
  favorite: boolean;
  deletedAt: string | null;
  tags: string[];
  likeCount: number;
  commentCount: number;
  width: number | null;
  height: number | null;
  previewQuality: string | null;
  originalQuality: string | null;
  thumbUrl: string;
  previewUrl: string;
  originalUrl: string;
  downloadUrl: string;
};

export function toMediaDTO(media: MediaWithRelations): MediaDTO {
  const birth = media.child?.birthDate ?? null;
  return {
    id: media.id,
    kind: media.kind,
    fileName: media.fileName,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    childId: media.childId,
    childName: media.child?.name ?? null,
    childNickname: media.child?.nickname ?? null,
    albumId: media.albumId,
    capturedAt: media.capturedAt.toISOString(),
    capturedAtLabel: formatKstDateTime(media.capturedAt),
    ageMonths: birth ? ageMonthsAt(birth, media.capturedAt) : 0,
    ageLabel: birth ? ageLabelAt(birth, media.capturedAt) : "-",
    visibility: media.visibility,
    visibilityLabel: VISIBILITY_LABEL[media.visibility] ?? media.visibility,
    favorite: media.favorite,
    deletedAt: media.deletedAt ? media.deletedAt.toISOString() : null,
    tags: (media.tags ?? []).map((t) => t.tag.name),
    likeCount: media._count?.likes ?? 0,
    commentCount: media._count?.comments ?? 0,
    width: media.width,
    height: media.height,
    previewQuality: media.previewQuality,
    originalQuality: media.originalQuality,
    thumbUrl: `/api/media/${media.id}/file?size=thumb`,
    previewUrl: `/api/media/${media.id}/file?size=preview`,
    originalUrl: `/api/media/${media.id}/file?size=original`,
    downloadUrl: `/api/media/${media.id}/download`,
  };
}
