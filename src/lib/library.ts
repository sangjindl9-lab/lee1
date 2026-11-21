import prisma from "./db";
import { toMediaDTO, type MediaWithRelations } from "./serialize";
import { kstDateKey } from "./date";
import { VISIBILITY } from "./constants";

const withRelations = {
  tags: { include: { tag: true } },
  child: { select: { id: true, name: true, nickname: true, birthDate: true } },
  _count: { select: { likes: true, comments: true } },
} as const;

export class LibraryError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 조부모·가족 계정에는 '부모만 공개'·'나만 보기' 항목을 보여주지 않는다. */
export function visibilityWhere(viewerRole: string | undefined) {
  // 직접 업로드가 끝나지 않았거나 실패한 항목은 앨범에 보이지 않는다
  const status = { status: { in: ["READY", "PROCESSING"] } };
  return viewerRole === "PARENT" || viewerRole == null ? status : { ...status, visibility: "FAMILY" };
}

export async function listAlbumMedia(opts: {
  familyId: string;
  childId?: string;
  albumId?: string;
  includeDeleted?: boolean;
  viewerRole?: string;
  limit?: number;
}) {
  const rows = await prisma.mediaAsset.findMany({
    where: {
      familyId: opts.familyId,
      ...visibilityWhere(opts.viewerRole),
      ...(opts.childId ? { childId: opts.childId } : {}),
      ...(opts.albumId ? { albumId: opts.albumId } : {}),
      ...(opts.includeDeleted ? {} : { deletedAt: null }),
    },
    include: withRelations,
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 500,
  });
  return rows.map((r) => toMediaDTO(r as MediaWithRelations));
}

export async function getMediaOrThrow(mediaId: string, familyId: string, viewerRole?: string) {
  const media = await prisma.mediaAsset.findFirst({
    where: { id: mediaId, familyId, ...visibilityWhere(viewerRole) },
    include: withRelations,
  });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  return media as MediaWithRelations;
}

/**
 * 삭제 = 휴지통 이동(소프트 삭제). 아이/앨범/촬영일/공개범위는 그대로 보존한다.
 * 파일은 즉시 지우지 않아 복구가 가능하다.
 */
export async function moveToTrash(mediaId: string, opts: { userId: string; familyId: string }) {
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, familyId: opts.familyId } });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  if (media.deletedAt) return { alreadyInTrash: true, media: toMediaDTO(await getMediaOrThrow(mediaId, opts.familyId)) };
  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { deletedAt: new Date(), deletedById: opts.userId },
    include: withRelations,
  });
  return { alreadyInTrash: false, media: toMediaDTO(updated as MediaWithRelations) };
}

/**
 * 휴지통 복구.
 * 복구 대상(아이/앨범/촬영일/공개범위)은 DB에 저장된 원래 값만 사용한다.
 * 클라이언트가 다른 아이를 지정해도 무시하므로 "다른 아이 앨범으로 잘못 복구"되지 않는다.
 */
export async function restoreFromTrash(
  mediaId: string,
  opts: { userId: string; familyId: string; requestedChildId?: string | null; requestedAlbumId?: string | null },
) {
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, familyId: opts.familyId } });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  if (!media.deletedAt) throw new LibraryError("NOT_IN_TRASH", "휴지통에 없는 항목입니다.", 409);

  // 원래 앨범이 실제로 같은 아이의 앨범인지 확인. 어긋나 있으면 아이의 기본 앨범으로 바로잡는다.
  let albumId = media.albumId;
  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || album.childId !== media.childId) {
    const fallback = await prisma.album.findFirst({ where: { childId: media.childId }, orderBy: { createdAt: "asc" } });
    if (!fallback) throw new LibraryError("ALBUM_NOT_FOUND", "원래 앨범을 찾을 수 없어 복구할 수 없습니다.", 409);
    albumId = fallback.id;
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { deletedAt: null, deletedById: null, albumId, visibility: media.visibility },
    include: withRelations,
  });

  return {
    media: toMediaDTO(updated as MediaWithRelations),
    restoredTo: {
      childId: updated.childId,
      albumId: updated.albumId,
      capturedAt: updated.capturedAt.toISOString(),
      visibility: updated.visibility,
    },
    ignoredRequest: {
      childId: opts.requestedChildId && opts.requestedChildId !== updated.childId ? opts.requestedChildId : null,
      albumId: opts.requestedAlbumId && opts.requestedAlbumId !== updated.albumId ? opts.requestedAlbumId : null,
    },
  };
}

export async function listTrash(familyId: string, viewerRole?: string) {
  const rows = await prisma.mediaAsset.findMany({
    where: { familyId, deletedAt: { not: null }, ...visibilityWhere(viewerRole) },
    include: withRelations,
    orderBy: { deletedAt: "desc" },
  });
  return rows.map((r) => toMediaDTO(r as MediaWithRelations));
}

export async function toggleFavorite(mediaId: string, familyId: string, favorite?: boolean) {
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, familyId } });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { favorite: favorite ?? !media.favorite },
    include: withRelations,
  });
  return toMediaDTO(updated as MediaWithRelations);
}

export async function updateVisibility(mediaId: string, familyId: string, visibility: string) {
  if (!Object.values(VISIBILITY).includes(visibility as never)) {
    throw new LibraryError("INVALID_VISIBILITY", "공개 범위 값이 올바르지 않습니다.");
  }
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, familyId } });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { visibility },
    include: withRelations,
  });
  return toMediaDTO(updated as MediaWithRelations);
}

export async function attachTags(mediaId: string, familyId: string, tagNames: string[]) {
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, familyId } });
  if (!media) throw new LibraryError("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
  const names = [...new Set(tagNames.map((t) => t.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
  for (const name of names) {
    const tag = await prisma.tag.upsert({
      where: { familyId_name: { familyId, name } },
      create: { familyId, name },
      update: {},
    });
    await prisma.mediaTag.upsert({
      where: { mediaId_tagId: { mediaId, tagId: tag.id } },
      create: { mediaId, tagId: tag.id },
      update: {},
    });
  }
  return toMediaDTO(await getMediaOrThrow(mediaId, familyId));
}

export async function detachTag(mediaId: string, familyId: string, tagName: string) {
  const tag = await prisma.tag.findFirst({ where: { familyId, name: tagName.replace(/^#/, "") } });
  if (!tag) return toMediaDTO(await getMediaOrThrow(mediaId, familyId));
  await prisma.mediaTag.deleteMany({ where: { mediaId, tagId: tag.id } });
  return toMediaDTO(await getMediaOrThrow(mediaId, familyId));
}

export async function listTags(familyId: string) {
  const tags = await prisma.tag.findMany({
    where: { familyId },
    include: { _count: { select: { media: true } } },
    orderBy: { name: "asc" },
  });
  return tags.map((t) => ({ id: t.id, name: t.name, count: t._count.media }));
}

export async function toggleLike(mediaId: string, userId: string, familyId: string, viewerRole?: string) {
  await getMediaOrThrow(mediaId, familyId, viewerRole);
  const existing = await prisma.like.findUnique({ where: { mediaId_userId: { mediaId, userId } } });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
  } else {
    await prisma.like.create({ data: { mediaId, userId } });
  }
  const likes = await prisma.like.count({ where: { mediaId } });
  const mine = Boolean(await prisma.like.findUnique({ where: { mediaId_userId: { mediaId, userId } } }));
  return { liked: mine, likeCount: likes };
}

export async function listComments(mediaId: string) {
  const rows = await prisma.comment.findMany({
    where: { mediaId },
    include: { user: { select: { id: true, name: true, relation: true, role: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.user.name,
    relation: c.user.relation,
    createdAt: c.createdAt.toISOString(),
    createdAtLabel: `${kstDateKey(c.createdAt)}`,
  }));
}

export async function addComment(mediaId: string, userId: string, familyId: string, body: string, viewerRole?: string) {
  const trimmed = body.trim();
  if (!trimmed) throw new LibraryError("EMPTY_COMMENT", "댓글 내용을 입력해 주세요.");
  if (trimmed.length > 500) throw new LibraryError("COMMENT_TOO_LONG", "댓글은 500자까지 쓸 수 있습니다.");
  await getMediaOrThrow(mediaId, familyId, viewerRole);
  const comment = await prisma.comment.create({
    data: { mediaId, userId, body: trimmed },
    include: { user: { select: { name: true, relation: true } } },
  });
  return {
    id: comment.id,
    body: comment.body,
    author: comment.user.name,
    relation: comment.user.relation,
    createdAt: comment.createdAt.toISOString(),
    createdAtLabel: kstDateKey(comment.createdAt),
  };
}
