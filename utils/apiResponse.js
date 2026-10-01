export const ok = (res, data, message = 'Success', status = 200, meta) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

export const created = (res, data, message = 'Created') => ok(res, data, message, 201);

export const fail = (res, message = 'Something went wrong', status = 400, errors = null) =>
  res.status(status).json({ success: false, message, errors });
