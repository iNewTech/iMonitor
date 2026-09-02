function normalizeQuery(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function levenshteinDistance(left, right) {
    if (left === right) {
        return 0;
    }

    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, (_, rowIndex) => (
        Array.from({ length: cols }, (_, colIndex) => (
            rowIndex === 0 ? colIndex : colIndex === 0 ? rowIndex : 0
        ))
    ));

    for (let row = 1; row < rows; row += 1) {
        for (let col = 1; col < cols; col += 1) {
            const cost = left[row - 1] === right[col - 1] ? 0 : 1;
            matrix[row][col] = Math.min(
                matrix[row - 1][col] + 1,
                matrix[row][col - 1] + 1,
                matrix[row - 1][col - 1] + cost
            );
        }
    }

    return matrix[rows - 1][cols - 1];
}

function getDistanceThreshold(word) {
    if (word.length >= 8) {
        return 2;
    }

    return word.length >= 5 ? 1 : 0;
}

const WAITING_STATUSES = new Set(['MSGW', 'LCKW', 'DEQW', 'DLYW']);

function matchesSearch(haystack, query) {
    if (haystack.includes(query)) {
        return true;
    }

    const haystackWords = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    const queryWords = query.split(/[^a-z0-9]+/).filter(Boolean);

    return queryWords.every((queryWord) => (
        haystackWords.some((haystackWord) => (
            haystackWord.includes(queryWord)
            || queryWord.includes(haystackWord)
            || levenshteinDistance(haystackWord, queryWord) <= getDistanceThreshold(queryWord)
        ))
    ));
}

/**
 * Returns sorted subsystem options for the current table.
 */
export function getSubsystemOptions(jobs) {
    return Array.from(new Set(
        jobs
            .map((job) => String(job?.SUBSYSTEM || '').trim().toUpperCase())
            .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));
}

/**
 * Filters jobs by subsystem and fuzzy text search.
 */
export function filterJobs(jobs, filters) {
    const subsystem = String(filters?.subsystem || '').trim().toUpperCase();
    const query = normalizeQuery(filters?.query);
    const status = String(filters?.status || 'ALL').trim().toUpperCase();

    return jobs.filter((job) => {
        if (subsystem && subsystem !== 'ALL' && String(job?.SUBSYSTEM || '').trim().toUpperCase() !== subsystem) {
            return false;
        }

        const jobStatus = String(job?.STATUS || '').trim().toUpperCase();
        if (status === 'WAITING' && !WAITING_STATUSES.has(jobStatus)) {
            return false;
        }
        if (status !== 'ALL' && status !== 'WAITING' && jobStatus !== status) {
            return false;
        }

        if (!query) {
            return true;
        }

        const searchableFields = [
            job?.JOB_NAME,
            job?.JOB_NAME_SHORT,
            job?.SUBSYSTEM,
            job?.SUBSYSTEM_JOB,
            job?.STATUS,
            job?.FUNCTION_NAME,
            job?.SQL_STATEMENT_STATUS,
            job?.CURRENT_USER,
            job?.JOB_USER
        ]
            .map((value) => normalizeQuery(value))
            .filter(Boolean);

        return searchableFields.some((field) => matchesSearch(field, query));
    });
}
