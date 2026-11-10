export async function resolveActorId(prisma, actorId) {
  if (!actorId) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });
    return user ? user.id : null;
  } catch {
    return null;
  }
}

export async function recordAudit(prisma, input) {
  try {
    const validUserId = await resolveActorId(prisma, input.userId);
    let validFactoryId = input.factoryId ?? null;
    if (validFactoryId) {
      const fac = await prisma.factory
        .findUnique({ where: { id: validFactoryId }, select: { id: true } })
        .catch(() => null);
      if (!fac) validFactoryId = null;
    }

    let detailsObj = input.details;
    if (input.userId && !validUserId) {
      const base =
        typeof detailsObj === 'object' && detailsObj !== null
          ? { ...detailsObj }
          : detailsObj
            ? { message: detailsObj }
            : {};
      base.remoteActor = 'Head Office Admin';
      base.remoteUserId = input.userId;
      detailsObj = base;
    }

    const detailsStr =
      typeof detailsObj === 'object' && detailsObj !== null
        ? JSON.stringify(detailsObj)
        : detailsObj;

    return await prisma.auditLog.create({
      data: {
        userId: validUserId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        details: detailsStr ?? null,
        factoryId: validFactoryId,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
    return null;
  }
}
