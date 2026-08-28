import type { ActiveJobRecord } from '../../services/ibmi';

export interface JobFilterState {
    subsystem: string;
    query: string;
}

/**
 * Returns sorted subsystem options for the latest job list.
 */
export function getSubsystemOptions(jobs: ActiveJobRecord[]) {
    return Array.from(new Set(
        jobs
            .map((job) => String(job.SUBSYSTEM || '').trim().toUpperCase())
            .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));
}

/**
 * Filters jobs by subsystem and fuzzy operator search.
 */
export function filterJobs(jobs: ActiveJobRecord[], filters: JobFilterState) {
    const subsystem = String(filters.subsystem || '').trim().toUpperCase();
    const query = normalizeQuery(filters.query);

    return jobs.filter((job) => {
        if (subsystem && subsystem !== 'ALL' && String(job.SUBSYSTEM || '').trim().toUpperCase() !== subsystem) {
            return false;
        }

        if (!query) {
            return true;
        }

        const searchableFields = [
            job.JOB_NAME,
            job.JOB_NAME_SHORT,
            job.SUBSYSTEM,
            job.SUBSYSTEM_JOB,
            job.STATUS,
            job.FUNCTION_NAME,
            job.SQL_STATEMENT_STATUS,
            job.CURRENT_USER,
            job.JOB_USER
        ]
            .map((value) => normalizeQuery(value))
            .filter(Boolean);

        return searchableFields.some((field) => matchesSearch(field, query));
    });
}

function matchesSearch(haystack: string, query: string) {
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

function getDistanceThreshold(word: string) {
    if (word.length >= 8) {
        return 2;
    }

    return word.length >= 5 ? 1 : 0;
}

function normalizeQuery(value: unknown) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function levenshteinDistance(left: string, right: string) {
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

