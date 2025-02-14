import Api from '../Api';
import ApiMethod from '../ApiMethod';
import ApiError from '../../shared/ApiError';
import apiMiddleware from '../apiMiddleware';
import * as express from 'express';
import * as runtypes from 'runtypes';
import * as httpMocks from 'node-mocks-http';
import * as timers from 'timers';

describe('api middleware', () => {
    const api = new Api({
        method1: new ApiMethod({
            params: runtypes.Intersect(
                runtypes.Record({
                    method1RequiredParam: runtypes.String
                }),
                runtypes.Partial({
                    method1OptionalParam: runtypes.String
                })
            ),
            action: params => `${params.method1RequiredParam}!`
        }),

        method2: new ApiMethod({
            params: runtypes.Record({
                method2RequiredParam: runtypes.Number
            }),
            action: () => {
                throw new Error('Unspecified error');
            }
        }),

        ['method3/path']: new ApiMethod({
            params: runtypes.Intersect(
                runtypes.Record({
                    method3RequiredParam: runtypes.String
                }),
                runtypes.Partial({
                    method3OptionalParam: runtypes.String
                })
            ),
            action: params => `${params.method3RequiredParam}!`
        }),

        ['batch/path']: new ApiMethod({
            params: runtypes.Intersect(
                runtypes.Record({
                    batchRequiredParam: runtypes.String
                }),
                runtypes.Partial({
                    batchOptionalParam: runtypes.String
                })
            ),
            action: params => `${params.batchRequiredParam}!`
        })
    });

    let onError: jest.Mock;
    let apiRequestHandler: express.RequestHandler;

    beforeEach(() => {
        onError = jest.fn();
        apiRequestHandler = apiMiddleware({ api, batchMaxSize: 2, onError });
    });

    describe('without batch', () => {
        it('should send error if body format is not valid', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/method1',
                body: 'wrong format' as any
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(
                    JSON.stringify({
                        error: {
                            type: 'BAD_REQUEST',
                            message: 'Unexpected body, expected method params'
                        }
                    })
                );
                expect(onError).toHaveBeenCalledWith(
                    new ApiError('BAD_REQUEST', 'Unexpected body, expected method params'),
                    request
                );
            });
        });

        it('should send method result', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/method1',
                body: { method1RequiredParam: 'test' }
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(JSON.stringify({ data: 'test!' }));
                expect(onError).not.toHaveBeenCalled();
            });
        });

        it('should send method result with composite path', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/method3/path',
                body: { method3RequiredParam: 'test' }
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(JSON.stringify({ data: 'test!' }));
                expect(onError).not.toHaveBeenCalled();
            });
        });

        it('should send method result with composite path includes batch', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/batch/path',
                body: { batchRequiredParam: 'test' }
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(JSON.stringify({ data: 'test!' }));
                expect(onError).not.toHaveBeenCalled();
            });
        });

        it('should send method error', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/method1',
                body: {}
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                // eslint-disable-next-line max-len
                const expectedErrorMessage = 'method1: Validation failed:\n{\n  "method1RequiredParam": "Expected string, but was missing"\n}.\nObject should match { method1RequiredParam: string; }';

                expect(response._getData()).toBe(
                    JSON.stringify({
                        error: {
                            type: 'BAD_REQUEST',
                            message: expectedErrorMessage,
                            data: {
                                name: 'ValidationError',
                                code: 'CONTENT_INCORRECT',
                                details: {
                                    method1RequiredParam: 'Expected string, but was missing'
                                }
                            }
                        }
                    })
                );
                expect(onError).toHaveBeenCalledWith(
                    new ApiError(
                        'BAD_REQUEST',
                        expectedErrorMessage
                    ),
                    request
                );
            });
        });
    });

    describe('with batch', () => {
        it('should send error if body format is not valid', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/batch',
                body: [{ method: 'method1' }]
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(
                    JSON.stringify({
                        error: {
                            type: 'BAD_REQUEST',
                            message: 'Unexpected body, expected array of methods'
                        }
                    })
                );
                expect(onError).toHaveBeenCalledWith(
                    new ApiError('BAD_REQUEST', 'Unexpected body, expected array of methods'),
                    request
                );
            });
        });

        it('should send error if batch size is too big', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/batch',
                body: [
                    { method: 'method1', params: { method1RequiredParam: 'test' } },
                    { method: 'method2', params: { method2RequiredParam: 1 } },
                    { method: 'method2', params: { method2RequiredParam: 1 } }
                ]
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            expect(response._getData()).toBe(
                JSON.stringify({
                    error: {
                        type: 'BAD_REQUEST',
                        message: 'Unexpected size of batch'
                    }
                })
            );
            expect(onError).toHaveBeenCalledWith(
                new ApiError('BAD_REQUEST', 'Unexpected size of batch'),
                request
            );
        });

        it('should send batch result', () => {
            const request = httpMocks.createRequest({
                method: 'POST',
                url: '/batch',
                body: [
                    { method: 'method1', params: { method1RequiredParam: 'test' } },
                    { method: 'method2', params: { method2RequiredParam: 1 } }
                ]
            });
            const response = httpMocks.createResponse();

            apiRequestHandler(request, response, () => {});

            return flushPromises().then(() => {
                expect(response._getData()).toBe(
                    JSON.stringify({
                        data: [
                            { data: 'test!' },
                            { error: { type: 'INTERNAL_ERROR', message: 'method2: Unspecified error', data: {} } }
                        ]
                    })
                );
                expect(onError).toHaveBeenCalledTimes(1);
                expect(onError).toHaveBeenCalledWith(
                    new ApiError('BAD_REQUEST', 'method2: Unspecified error'),
                    request
                );
            });
        });
    });
});

function flushPromises(): Promise<void> {
    return new Promise(timers.setImmediate);
}
