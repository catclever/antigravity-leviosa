const { findProjectDirByUUID } = require('./project_resolver');

module.exports = async function(query) {
    const uuid = query.uuid ? decodeURIComponent(query.uuid) : null;
    if (!uuid) {
        return { success: false, error: 'Missing uuid parameter' };
    }

    try {
        const paths = findProjectDirByUUID(uuid) || [];
        return { success: true, paths: paths };
    } catch (e) {
        return { success: false, error: e.message };
    }
};
