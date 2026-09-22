function exportOneToCsv(item) {
  const csvHeaders = Object.keys(item).join(',') + '\n'
  const csvValues = Object.values(item).join(',') + '\n'
  return csvHeaders + csvValues
}

export { exportOneToCsv }
