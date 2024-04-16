import { Channel, ConfigService, RequestContext, TransactionalConnection, User } from '@vendure/core';

/**
 * @description
 * Creates a {@link RequestContext} configured for the default Channel with the activeUser set
 * as the superadmin user. Useful for populating data.
 *
 * @docsCategory testing
 */
export async function getSuperadminContext(defaultChannel: Channel, connection: TransactionalConnection, configService: ConfigService): Promise<RequestContext> {
    const { superadminCredentials } = configService.authOptions;
    const superAdminUser = await connection
        .getRepository(User)
        .findOneOrFail({ where: { identifier: superadminCredentials.identifier } });
    return new RequestContext({
        channel: defaultChannel,
        apiType: 'admin',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        session: {
            id: '',
            token: '',
            expires: new Date(),
            cacheExpiry: 999999,
            user: {
                id: superAdminUser.id,
                identifier: superAdminUser.identifier,
                verified: true,
                channelPermissions: [],
            },
        },
    });
}