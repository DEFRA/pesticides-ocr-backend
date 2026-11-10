export async function getRegistrationHistory(
  registrations,
  reference,
  { pageSize, beforeVersion }
) {
  const entries = await registrations.listHistory(reference, {
    pageSize,
    beforeVersion
  })

  if (entries.length === 0) {
    return null
  }

  const data = entries.slice(0, pageSize)
  return {
    data,
    pagination: {
      pageSize,
      nextBeforeVersion: entries.length > pageSize ? data.at(-1).version : null
    }
  }
}
