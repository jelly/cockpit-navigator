/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React, { useContext, useEffect, useState } from "react";

import {
    AlertGroup, Alert, AlertVariant, AlertActionCloseButton
} from "@patternfly/react-core/dist/esm/components/Alert";
import { Card } from "@patternfly/react-core/dist/esm/components/Card";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import cockpit from "cockpit";
import { FsInfoClient, FileInfo } from "cockpit/fsinfo.ts";
import { EmptyStatePanel } from "cockpit-components-empty-state";
import { WithDialogs } from "dialogs";
import { useInit, usePageLocation } from "hooks";
import { superuser } from "superuser";

import { FilesBreadcrumbs } from "./files-breadcrumbs.tsx";
import { FilesFolderView } from "./files-folder-view.tsx";
import { FilesFooterDetail } from "./files-footer-detail.tsx";
import filetype_data from './filetype-data'; // eslint-disable-line import/extensions
import { filetype_lookup } from './filetype-lookup.ts';

superuser.reload_page_on_change();

interface Alert {
    key: string,
    title: string,
    variant: AlertVariant,
    detail?: string | React.ReactNode,
    actionLinks?: React.ReactNode
}

export interface FolderFileInfo extends FileInfo {
    name: string,
    to: string | null,
    category: { class: string } | null,
}

interface FilesContextType {
    addAlert: (title: string, variant: AlertVariant, key: string, detail?: string | React.ReactNode,
               actionLinks?: React.ReactNode) => void,
    removeAlert: (key: string) => void,
    cwdInfo: FileInfo | null,
}

export const FilesContext = React.createContext({
    addAlert: () => console.warn("FilesContext not initialized"),
    removeAlert: () => console.warn("FilesContext not initialized"),
    cwdInfo: null,
} as FilesContextType);

export const useFilesContext = () => useContext(FilesContext);

export const usePath = () => {
    const { options } = usePageLocation();
    let currentPath = decodeURIComponent(options.path?.toString() || "/");

    // Trim all trailing slashes
    currentPath = currentPath.replace(/\/+$/, '');

    // Our path will always be `/foo/` formatted
    if (!currentPath.endsWith("/")) {
        currentPath += "/";
    }

    if (!currentPath.startsWith("/")) {
        currentPath = `/${currentPath}`;
    }

    return currentPath;
};

export const Application = () => {
    const { options } = usePageLocation();
    const [loading, setLoading] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [files, setFiles] = useState<FolderFileInfo[]>([]);
    const [selected, setSelected] = useState<FolderFileInfo[]>([]);
    const [showHidden, setShowHidden] = useState(localStorage.getItem("files:showHiddenFiles") === "true");
    const [clipboard, setClipboard] = useState<string[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [cwdInfo, setCwdInfo] = useState<FileInfo | null>(null);

    const path = usePath();

    useEffect(() => {
        cockpit.user().then(user => {
            if (options.path === undefined) {
                cockpit.location.replace("/", { path: encodeURIComponent(user.home) });
            }
        });
    }, [options]);

    useEffect(
        () => {
            if (options.path === undefined) {
                return;
            }

            // Reset selected when path changes
            setSelected([]);

            const client = new FsInfoClient(
                path,
                ["type", "mode", "size", "mtime", "user", "group", "target", "entries", "targets"],
                { superuser: 'try' }
            );

            const disconnect = client.on('change', (state) => {
                setLoading(false);
                setLoadingFiles(!(state.info || state.error));
                setCwdInfo(state.info || null);
                setErrorMessage(state.error?.message ?? "");
                const entries = Object.entries(state?.info?.entries || {});
                const files = entries.map(([name, attrs]) => {
                    const to = FsInfoClient.target(state.info!, name)?.type ?? null;
                    const category = to === 'reg' ? filetype_lookup(filetype_data, name) : null;
                    return { ...attrs, name, to, category };
                });
                setFiles(files);
            });

            return () => {
                disconnect();
                client.close();
            };
        },
        [options, path]
    );

    useInit(() => {
        const onKeyboardNav = (e: KeyboardEvent) => {
            if (e.key === "L" && e.ctrlKey && !e.altKey) {
                e.preventDefault();
                document.dispatchEvent(new Event("manual-change-dir"));
            }
        };

        document.addEventListener("keydown", onKeyboardNav);

        return () => {
            document.removeEventListener("keydown", onKeyboardNav);
        };
    });

    if (loading)
        return <EmptyStatePanel loading />;

    const addAlert = (title: string, variant: AlertVariant, key: string, detail?: string | React.ReactNode,
        actionLinks?: React.ReactNode) => {
        setAlerts(prevAlerts => [
            ...prevAlerts, {
                title,
                variant,
                key,
                ...detail && { detail },
                ...actionLinks && { actionLinks },
            }
        ]);
    };
    const removeAlert = (key: string) => setAlerts(prevAlerts => prevAlerts.filter(alert => alert.key !== key));

    return (
        <Page>
            <FilesContext.Provider value={{ addAlert, removeAlert, cwdInfo }}>
                <WithDialogs>
                    <AlertGroup isToast isLiveRegion>
                        {alerts.map(alert => (
                            <Alert
                              variant={alert.variant}
                              title={alert.title}
                              actionClose={
                                  <AlertActionCloseButton
                                    title={alert.title}
                                    variantLabel={`${alert.variant} alert`}
                                    onClose={() => removeAlert(alert.key)}
                                  />
                              }
                              actionLinks={alert.actionLinks}
                              key={alert.key}
                            >
                                {alert.detail}
                            </Alert>
                        ))}
                    </AlertGroup>
                    <FilesBreadcrumbs path={path} />
                    <PageSection>
                        {errorMessage &&
                        <Card className="files-empty-state">
                            <EmptyStatePanel
                              paragraph={errorMessage}
                              icon={ExclamationCircleIcon}
                            />
                        </Card>}
                        {!errorMessage &&
                        <Stack className="files-view-stack">
                            <FilesFolderView
                              path={path}
                              files={files}
                              loadingFiles={loadingFiles}
                              showHidden={showHidden}
                              setShowHidden={setShowHidden}
                              selected={selected}
                              setSelected={setSelected}
                              clipboard={clipboard}
                              setClipboard={setClipboard}
                            />
                            <FilesFooterDetail
                              files={files}
                              selected={selected}
                              showHidden={showHidden}
                            />
                        </Stack>}
                    </PageSection>
                </WithDialogs>
            </FilesContext.Provider>
        </Page>
    );
};
