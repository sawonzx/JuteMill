export async function recordAudit(prisma, input) {
  try {
    const detailsStr =
      typeof input.details === 'object' && input.details !== null
        ? JSON.stringify(input.details)
        : input.details;
    return await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        details: detailsStr ?? null,
        factoryId: input.factoryId ?? null,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
    return null;
  }
}
